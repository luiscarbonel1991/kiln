"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import { ListingText, listingDraft, withCopy } from "@/domain/listing";
import {
  defaultTextModel,
  ImageQuality,
  ProviderId,
  VideoResolution,
} from "@/domain/model-defaults";
import { replan, SlotMove, slotCardId } from "@/domain/plan";
import { productUnderstanding } from "@/domain/product-understanding";
import { KnobChoice } from "@/domain/scene-knobs";
import { VideoChoice } from "@/domain/video";
import { refreshCards } from "@/lib/project-refresh";
import { slotCards, videoSlotCard } from "@/lib/project-start";
import { CATALOG } from "@/lib/recipes";
import { getStorageProvider } from "@/providers/registry";
import { getMakerModels, rememberHeroSetting } from "@/server/maker-repository";
import { productReference } from "@/server/product-reference";
import {
  addVideoToPlan,
  loadProjectBoard,
  refreshProjectProduct,
  setCardModel,
  setListing,
  setProjectReference,
  setSlotApproval,
  setSlotOff,
  setSlotOrder,
  setSlotTuning,
  setVideoChoice,
} from "@/server/project-repository";
import { type Degraded, writeListing } from "@/server/text-calls";

// Board mutations. Server Functions are POST-reachable: Zod is the trust
// boundary, and every write is scoped to the current maker by the repository.

const Approval = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  approved: z.boolean(),
});

export async function setSlotApprovalAction(input: unknown): Promise<void> {
  const { projectId, destinationId, slotKey, approved } = Approval.parse(input);
  await setSlotApproval(projectId, { destinationId, slotKey }, approved);
  refresh();
}

const Switch = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  off: z.boolean(),
});

export async function setSlotOffAction(
  input: unknown,
): Promise<{ error: string } | undefined> {
  const { projectId, destinationId, slotKey, off } = Switch.parse(input);
  try {
    await setSlotOff(projectId, { destinationId, slotKey }, off);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not switch it.",
    };
  }
  refresh();
}

const KnobWrite = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  choice: KnobChoice,
});

// Turn one of a scene's knobs (free): the plan keeps the stop and the slot's
// card is written again from it, on its own destination only.
export async function setSlotKnobAction(
  input: unknown,
): Promise<{ error: string } | undefined> {
  const { projectId, destinationId, slotKey, choice } = KnobWrite.parse(input);
  const cardId = slotCardId(destinationId, slotKey);
  try {
    const { product } = await setSlotTuning(
      projectId,
      { destinationId, slotKey },
      choice,
      ({ plan, master, product }) =>
        slotCards(
          {
            destinations: plan.destinations.filter(
              (d) => d.destinationId === destinationId,
            ),
          },
          master,
          productUnderstanding(product),
          product,
        ).find((card) => card.id === cardId),
    );
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
}

const EXTENSION: Record<(typeof ACCEPTED_IMAGE_MIME)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Upload the product's reference (a photo, or the plate from the maker's own
// renderer) and make it the project's anchor. The file and the project id come
// in one form, so no client-supplied URL is ever fetched by the server.
export async function addReferenceAction(formData: FormData): Promise<void> {
  const projectId = z.string().min(1).parse(formData.get("projectId"));
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");
  const mime = z.enum(ACCEPTED_IMAGE_MIME).parse(file.type);
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("Image is larger than 15 MB.");

  const loaded = await loadProjectBoard(projectId);
  if (!loaded?.board.plan || !loaded.product) {
    throw new Error("Only a planned project with a product takes a reference.");
  }
  const { url } = await getStorageProvider().put({
    key: `masters/${randomUUID()}.${EXTENSION[mime]}`,
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: mime,
  });
  const master = {
    id: randomUUID(),
    origin: "product" as const,
    sourcePrompt: null,
    assetUrl: url,
    mime,
  };
  const cards =
    loaded.board.cards.length === 0
      ? slotCards(
          loaded.board.plan,
          master,
          productUnderstanding(loaded.product),
          loaded.product,
          await getMakerModels(),
        )
      : [];
  await setProjectReference(projectId, master, cards);
  refresh();
}

// "Product changed — update the project": the project follows its product's
// current version. Free (no model call: a vector product's plate renders
// locally). The maker's own card edits are kept; outputs and approvals stay,
// and the board marks scenes made from the earlier version.
export async function updateProjectProductAction(
  input: unknown,
): Promise<{ error: string } | undefined> {
  const { projectId } = z.object({ projectId: z.string().min(1) }).parse(input);
  const loaded = await loadProjectBoard(projectId);
  if (!loaded?.board.plan || !loaded.product) {
    return { error: "Only a planned project with a product can be updated." };
  }
  const { board, product } = loaded;
  const plan = board.plan;
  if (!plan) return { error: "This project has no plan to update." };
  try {
    const understanding = productUnderstanding(product);
    const fresh = await productReference(product);
    const master = fresh ?? board.master;
    const cards = master
      ? refreshCards(
          board.cards,
          slotCards(
            plan,
            master,
            understanding,
            product,
            await getMakerModels(),
          ),
          master.id,
        )
      : board.cards;
    await refreshProjectProduct(projectId, {
      product,
      understanding,
      master: fresh,
      cards,
      textRules: (id) => CATALOG.destinations.find((d) => d.id === id)?.text,
      replan: (p) => replan(p, product, CATALOG.shotLists).plan,
    });
  } catch (error) {
    return {
      error: `The project could not be updated: ${(error as Error).message}`,
    };
  }
  refresh();
}

const ListingWrite = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// "Write it with the text model": the maker's text model (or the one the
// degraded notice offers) rewrites the listing's prose, under the cap. Only
// the fields the maker has not written are replaced; the result is saved and
// checked like the draft.
export async function writeListingAction(
  input: unknown,
): Promise<{ degraded?: Degraded; error?: string }> {
  const parsed = ListingWrite.safeParse(input);
  if (!parsed.success) return { error: "Nothing to write for." };
  const { projectId, destinationId } = parsed.data;
  const loaded = await loadProjectBoard(projectId);
  const plan = loaded?.board.plan?.destinations.find(
    (d) => d.destinationId === destinationId,
  );
  const destination = CATALOG.destinations.find((d) => d.id === destinationId);
  if (!loaded?.product || !plan || !destination?.text) {
    return { error: "This destination has no listing text." };
  }
  const current =
    plan.listing ?? listingDraft(loaded.product, destination.text);
  const result = await writeListing(
    {
      channel: destination.name,
      product: loaded.product,
      rules: destination.text,
      draft: current,
    },
    parsed.data.model ?? defaultTextModel(await getMakerModels()),
  );
  if (!result.copy) return { degraded: result.degraded };
  try {
    await setListing(projectId, destinationId, withCopy(current, result.copy));
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return {};
}

const ListingSave = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  listing: ListingText,
});

// Save a destination's listing text as the maker left it (the fields they
// edited say so). Free; checked again on every read.
export async function saveListingAction(
  input: unknown,
): Promise<{ error: string } | undefined> {
  const parsed = ListingSave.safeParse(input);
  if (!parsed.success) return { error: "The listing text could not be read." };
  const { projectId, destinationId, listing } = parsed.data;
  try {
    await setListing(projectId, destinationId, listing);
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
}

const Move = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  move: SlotMove,
});

// Reorder a destination's photos: make a slot photo 1, or move it one place.
export async function moveSlotAction(input: z.infer<typeof Move>) {
  const { projectId, destinationId, slotKey, move } = Move.parse(input);
  await setSlotOrder(projectId, { destinationId, slotKey }, move);
  refresh();
}

const Video = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
  slotKey: z.string().min(1),
  choice: VideoChoice,
});

// Change a video slot's start frame, motion, length or orientation.
export async function setVideoChoiceAction(input: z.infer<typeof Video>) {
  const { projectId, destinationId, slotKey, choice } = Video.parse(input);
  await setVideoChoice(projectId, { destinationId, slotKey }, choice);
  refresh();
}

const AddVideo = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
});

// Give a project made before video its destination's video slot.
export async function addVideoAction(
  input: z.infer<typeof AddVideo>,
): Promise<{ error?: string }> {
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
}

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
export async function setCardModelAction(
  input: z.infer<typeof CardModel>,
): Promise<{ error?: string }> {
  const { projectId, cardId, model } = CardModel.parse(input);
  try {
    await setCardModel(projectId, cardId, model);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  refresh();
  return {};
}
