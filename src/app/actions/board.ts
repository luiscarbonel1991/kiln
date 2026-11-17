"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ACCEPTED_IMAGE_MIME } from "@/components/studio/constants";
import { ListingText } from "@/domain/listing";
import {
  ImageQuality,
  ProviderId,
  VideoResolution,
} from "@/domain/model-defaults";
import type { RanOn } from "@/domain/model-routing";
import {
  type ProjectPlan,
  replan,
  SlotMove,
  withSlotPlace,
  withSlotTuning,
  withThreeQuarter,
} from "@/domain/plan";
import {
  lookReference,
  projectLook,
  projectProduct,
  withLookReferences,
  withLooksInUse,
  withoutUndrawnLooks,
} from "@/domain/plan-look";
import { productUnderstanding } from "@/domain/product-understanding";
import { KnobChoice, ReasonKey } from "@/domain/scene-knobs";
import { VideoChoice } from "@/domain/video";
import { refreshCards } from "@/lib/project-refresh";
import { slotCards, videoSlotCard } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { makerAction } from "@/server/guarded";
import { noteApproval, noteReason } from "@/server/lessons";
import { writeProjectListing } from "@/server/listing-write";
import { getMakerModels, rememberHeroSetting } from "@/server/maker-repository";
import { lookedReference, redrawnLooks } from "@/server/product-reference";
import { addProjectReference } from "@/server/project-reference";
import {
  addVideoToPlan,
  loadProjectBoard,
  refreshProjectProduct,
  setCardModel,
  setListing,
  setSlotApproval,
  setSlotOff,
  setSlotOrder,
  setVideoChoice,
} from "@/server/project-repository";
import { recheckTake } from "@/server/qc/project-take";
import { relookSlot, retuneSlot } from "@/server/slot-tuning";
import { makeStillsVideo } from "@/server/stills-video";
import type { Degraded } from "@/server/text-calls";

// Board mutations. Server Functions are POST-reachable: Zod is the trust
// boundary, and every write is scoped to the current maker by the repository.

const Approval = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  approved: z.boolean(),
});

export const setSlotApprovalAction = makerAction(
  async (_maker, input: unknown): Promise<void> => {
    const { projectId, destinationId, slotKey, approved } =
      Approval.parse(input);
    await setSlotApproval(projectId, { destinationId, slotKey }, approved);
    if (approved) await noteApproval(projectId, { destinationId, slotKey });
    refresh();
  },
);

const Switch = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  off: z.boolean(),
});

export const setSlotOffAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const { projectId, destinationId, slotKey, off } = Switch.parse(input);
    try {
      await setSlotOff(projectId, { destinationId, slotKey }, off);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not switch it.",
      };
    }
    refresh();
  },
);

const Frame = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
});

// Read a scene's shown take again (free): one from before the check, or one
// left unchecked.
export const checkTakeAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const { projectId, destinationId, slotKey } = Frame.parse(input);
    try {
      await recheckTake(projectId, { destinationId, slotKey });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not check it.",
      };
    }
    refresh();
  },
);

const KnobWrite = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  choice: KnobChoice,
  // The "What's off?" chip that moved it, a vote for the family's lessons.
  reason: ReasonKey.optional(),
});

// Turn one of a scene's knobs.
export const setSlotKnobAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const { projectId, destinationId, slotKey, choice, reason } =
      KnobWrite.parse(input);
    const ref = { destinationId, slotKey };
    try {
      const { product } = await retuneSlot(projectId, ref, (plan) =>
        withSlotTuning(plan, ref, choice),
      );
      if (reason) await noteReason(projectId, ref, reason, choice);
      // A hero's setting chosen on the board is proposed next time for this
      // family on this destination.
      if (
        choice.knob === "setting" &&
        (choice.stop === "sweep" || choice.stop === "place") &&
        product
      ) {
        await rememberHeroSetting(destinationId, product.family, choice.stop);
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not tune it.",
      };
    }
    refresh();
  },
);

const LookKey = z.string().min(1).max(64).nullable().optional();
const LookWrite = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  // A key, null for the project's, left out to keep the frame's.
  colour: LookKey,
  style: LookKey,
});

// Show one scene in a colour and style of its own, or the project's again
// (null): free, its card is written again in it.
export const setSlotLookAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const parsed = LookWrite.safeParse(input);
    if (!parsed.success) return { error: "Pick a colour or a style." };
    const { projectId, destinationId, slotKey, colour, style } = parsed.data;
    try {
      await relookSlot(
        projectId,
        { destinationId, slotKey },
        {
          ...(colour !== undefined ? { colour } : {}),
          ...(style !== undefined ? { style } : {}),
        },
      );
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not change it.",
      };
    }
    refresh();
  },
);

const PlaceWrite = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  place: z.string().trim().max(160).nullable(),
});

// Give a scene its own place (from Tune or the market brief), or back to the
// product's places (null or blank). A hero given a place stands in it, and
// that setting is remembered for the family like one chosen in Tune.
export const setSlotPlaceAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const parsed = PlaceWrite.safeParse(input);
    if (!parsed.success) return { error: "A place is at most 160 characters." };
    const { projectId, destinationId, slotKey, place } = parsed.data;
    const ref = { destinationId, slotKey };
    try {
      const { product, plan } = await retuneSlot(projectId, ref, (p) =>
        withSlotPlace(p, ref, place || null),
      );
      const slot = plan.destinations
        .find((d) => d.destinationId === destinationId)
        ?.slots.find((s) => s.key === slotKey);
      if (place && slot?.knobs?.setting !== undefined && product) {
        await rememberHeroSetting(destinationId, product.family, "place");
      }
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Could not set the place.",
      };
    }
    refresh();
  },
);

const _EXTENSION: Record<(typeof ACCEPTED_IMAGE_MIME)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Upload the product's reference (a photo, or the plate from the maker's own
// renderer) and make it the project's anchor. The file and the project id come
// in one form, so no client-supplied URL is ever fetched by the server.
export const addReferenceAction = makerAction(
  async (_maker, formData: FormData): Promise<void> => {
    const projectId = z.string().min(1).parse(formData.get("projectId"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("No file provided.");
    const outcome = await addProjectReference(
      projectId,
      new Uint8Array(await file.arrayBuffer()),
    );
    if (!outcome.ok) throw new Error(outcome.error);
    refresh();
  },
);

// "Product changed — update the project": the project follows its product's
// current version. Free (no model call: a vector product's plate renders
// locally). The maker's own card edits are kept; outputs and approvals stay,
// and the board marks scenes made from the earlier version.
export const updateProjectProductAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const { projectId } = z
      .object({ projectId: z.string().min(1) })
      .parse(input);
    const loaded = await loadProjectBoard(projectId);
    if (!loaded?.board.plan || !loaded.product) {
      return { error: "Only a planned project with a product can be updated." };
    }
    const { board, product } = loaded;
    const plan = board.plan;
    if (!plan) return { error: "This project has no plan to update." };
    try {
      // Every look the project uses is drawn again from the product as it is
      // now, its own first: its plate is the fresh reference.
      const look = projectLook(plan, product);
      const { master: fresh, drawn } = await lookedReference(product, look);
      const master = fresh ?? board.master;
      const own = drawn ?? lookReference(plan, look);
      const others = await redrawnLooks(product, plan, look);
      // A fresh plate gets its view from above drawn again beside it; a
      // maker's own reference keeps the plan's (it no longer applies).
      // A frame whose look no longer draws shows the project's look again.
      const viewed = (p: ProjectPlan) => {
        const kept = withLooksInUse(
          withoutUndrawnLooks(
            withLookReferences(p, [...(own ? [own] : []), ...others]),
            product,
          ),
          product,
        );
        return fresh
          ? withThreeQuarter(kept, drawn?.threeQuarter ?? null)
          : kept;
      };
      const understanding = productUnderstanding(
        projectProduct(product, viewed(plan)),
      );
      const cards = master
        ? refreshCards(
            board.cards,
            slotCards(viewed(plan), master, product, await getMakerModels()),
            master.id,
          )
        : board.cards;
      await refreshProjectProduct(projectId, {
        product,
        understanding,
        master: fresh,
        cards,
        textRules: (id) => CATALOG.destinations.find((d) => d.id === id)?.text,
        replan: (p) => viewed(replan(p, product, CATALOG.shotLists).plan),
      });
    } catch (error) {
      return {
        error: `The project could not be updated: ${(error as Error).message}`,
      };
    }
    refresh();
  },
);

const ListingWrite = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// "Write it with the text model": the deep route (or the model the degraded
// notice offers) rewrites the listing's prose, under the cap. Only the fields
// the maker has not written are replaced; the result is saved and checked
// like the draft.
export const writeListingAction = makerAction(
  async (
    _maker,
    input: unknown,
  ): Promise<{ degraded?: Degraded; ranOn?: RanOn; error?: string }> => {
    const parsed = ListingWrite.safeParse(input);
    if (!parsed.success) return { error: "Nothing to write for." };
    const { projectId, destinationId, model } = parsed.data;
    const result = await writeProjectListing(projectId, destinationId, model);
    if ("error" in result) return { error: result.error };
    if ("degraded" in result) return { degraded: result.degraded };
    refresh();
    return result.ranOn ? { ranOn: result.ranOn } : {};
  },
);

const ListingSave = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  listing: ListingText,
});

// Save a destination's listing text as the maker left it (the fields they
// edited say so). Free; checked again on every read.
export const saveListingAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const parsed = ListingSave.safeParse(input);
    if (!parsed.success)
      return { error: "The listing text could not be read." };
    const { projectId, destinationId, listing } = parsed.data;
    try {
      await setListing(projectId, destinationId, listing);
    } catch (error) {
      return { error: (error as Error).message };
    }
    refresh();
  },
);

const Move = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  move: SlotMove,
});

// Reorder a destination's photos: make a slot photo 1, or move it one place.
export const moveSlotAction = makerAction(
  async (_maker, input: z.infer<typeof Move>) => {
    const { projectId, destinationId, slotKey, move } = Move.parse(input);
    await setSlotOrder(projectId, { destinationId, slotKey }, move);
    refresh();
  },
);

const Video = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  choice: VideoChoice,
});

// Change a video slot's start frame, motion, length or orientation.
export const setVideoChoiceAction = makerAction(
  async (_maker, input: z.infer<typeof Video>) => {
    const { projectId, destinationId, slotKey, choice } = Video.parse(input);
    await setVideoChoice(projectId, { destinationId, slotKey }, choice);
    refresh();
  },
);

const Stills = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
});

// Make the stills-in-motion video from the approved scenes: free, local,
// the video card's take to review.
export const makeStillsVideoAction = makerAction(
  async (_maker, input: unknown): Promise<{ error: string } | undefined> => {
    const parsed = Stills.safeParse(input);
    if (!parsed.success) return { error: "Name the video frame." };
    const { projectId, destinationId, slotKey } = parsed.data;
    const made = await makeStillsVideo(projectId, { destinationId, slotKey });
    if ("error" in made) return made;
    refresh();
  },
);

const AddVideo = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
});

// Give a project made before video its destination's video slot.
export const addVideoAction = makerAction(
  async (
    _maker,
    input: z.infer<typeof AddVideo>,
  ): Promise<{ error?: string }> => {
    const { projectId, destinationId } = AddVideo.parse(input);
    try {
      const models = await getMakerModels();
      await addVideoToPlan(
        projectId,
        destinationId,
        CATALOG.shotLists,
        (slot, shotListId, master, understanding) =>
          videoSlotCard(
            destinationId,
            shotListId,
            slot,
            master,
            understanding,
            models,
          ),
      );
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    refresh();
    return {};
  },
);

const CardModel = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  model: z.object({
    provider: ProviderId,
    model: z.string().min(1),
    quality: ImageQuality.optional(),
    resolution: VideoResolution.optional(),
  }),
});

// A slot's own model (the board's picker): refused with the reason when Kiln
// does not offer it or has no price for it.
export const setCardModelAction = makerAction(
  async (
    _maker,
    input: z.infer<typeof CardModel>,
  ): Promise<{ error?: string }> => {
    const { projectId, cardId, model } = CardModel.parse(input);
    try {
      await setCardModel(projectId, cardId, model);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    refresh();
    return {};
  },
);
