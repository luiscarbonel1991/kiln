import { z } from "zod";
import type { DestinationKind, DestinationProfile } from "@/domain/destination";
import { estimateVideo } from "@/domain/generation-cost";
import { ListingText } from "@/domain/listing";
import {
  type ListingRead,
  ListingResults,
  type ReadKey,
} from "@/domain/listing-results";
import {
  ListingUrl,
  type LivePhoto,
  MAX_LIVE_PHOTOS,
} from "@/domain/live-listing";
import { MarketBrief } from "@/domain/market-brief";
import type { VideoResolution } from "@/domain/model-defaults";
import type { Product } from "@/domain/product";
import { Look } from "@/domain/product-look";
import type { ProjectType } from "@/domain/project";
import { type KnobChoice, SavedKnobs } from "@/domain/scene-knobs";
import {
  PlanReferences,
  type ThreeQuarterView,
} from "@/domain/scene-reference";
import {
  type ExactKind,
  exactKindMatchesFill,
  type ShotList,
  ShotSlotFields,
  versionMatchesFill,
} from "@/domain/shot-list";
import {
  snapSeconds,
  stillsSecondsFor,
  type VideoChoice,
  VideoChoice as VideoChoiceSchema,
  type VideoMotion,
  type VideoOrientation,
  type VideoSeconds,
  videoSecondsFor,
} from "@/domain/video";

// A project's plan (ROADMAP "Experience design"): one storyboard row per
// destination, one slot per frame of its shot list, snapshotted at Start so the
// project stays stable when seeds change. Board-owned state (approval, delivery)
// lives here, never on the editor's cards — autosave rewrites the cards.
export const PlanSlot = ShotSlotFields.extend({
  approvedOutput: z.string().min(1).optional(),
  deliveredAt: z.string().optional(),
  // Switched off by the maker (a gift shot for a product nobody gifts): the
  // slot stays in the plan, so the plan keeps its shape, but leaves the
  // deliverable — never generated, never counted. Absent = on.
  off: z.boolean().optional(),
  // A video slot's choices (start frame, motion, length, orientation).
  video: VideoChoiceSchema.optional(),
  // A scene slot's knobs (its defaults, snapshotted with the slot) and the
  // stops the maker chose, read tolerantly: a stop a later version drops reads
  // as unset instead of breaking the plan.
  knobs: SavedKnobs.optional(),
  tuned: SavedKnobs.optional(),
  // The stops the maker's kept lessons set for this frame of the product's
  // family when the plan was made (lesson.ts): over Kiln's pick, under the
  // maker's own choices.
  learned: SavedKnobs.optional(),
  // A scene slot's own place of use, chosen by the maker (from the product's
  // places, the market brief, or typed): it stands there instead of taking
  // the product's next place.
  place: z.string().trim().min(1).max(160).optional(),
  // A scene slot's own colour and style (plan-look.ts), over the project's;
  // read leniently.
  look: Look.optional().catch(undefined),
  // A photo slot's photo: the maker's own image, in Kiln's storage, delivered
  // as it is.
  photo: z.string().min(1).optional(),
  // The live listing's photo this frame replaces (a refresh), shown beside it
  // on the board, and back in its place if the frame no longer applies.
  before: z
    .object({ url: z.string().min(1), aspect: z.string().min(1) })
    .optional(),
})
  .refine(exactKindMatchesFill.check, {
    message: exactKindMatchesFill.message,
  })
  .refine((s) => (s.fill === "photo") === (s.photo !== undefined), {
    message: "a photo slot carries its photo; no other slot does",
  })
  .refine(versionMatchesFill.check, { message: versionMatchesFill.message });
export type PlanSlot = z.infer<typeof PlanSlot>;

export const PlanDestination = z.object({
  destinationId: z.string().min(1),
  shotListId: z.string().min(1),
  slots: z.array(PlanSlot).min(1),
  // The listing text once saved (edited, or written by the text model); until
  // then the board shows the free draft from the spec.
  listing: ListingText.optional(),
  // The live listing this destination refreshes (never fetched).
  listingUrl: ListingUrl.optional(),
  // Why this listing looks as it does: the searches it aims at and what
  // page 1 shows for them (Phase 20).
  brief: MarketBrief.optional(),
  // Its numbers before and after the new photos went up (Phase 20).
  results: ListingResults.optional(),
});
export type PlanDestination = z.infer<typeof PlanDestination>;

export const ProjectPlan = z.object({
  destinations: z.array(PlanDestination).min(1),
  // The colour and style the project shows, chosen at New project
  // (plan-look.ts); absent, the product's default. Read leniently.
  look: Look.optional().catch(undefined),
  // Images Kiln drew for the scenes besides the project's reference: the
  // product seen from a little above, and each look in use
  // (scene-reference.ts). Read leniently.
  references: PlanReferences.optional().catch(undefined),
});
export type ProjectPlan = z.infer<typeof ProjectPlan>;

export const SlotState = z.enum([
  "off",
  "exact",
  "kept",
  "queued",
  "generating",
  "retrying",
  "to-review",
  "approved",
  "delivered",
]);
export type SlotState = z.infer<typeof SlotState>;

export interface Catalog {
  destinations: DestinationProfile[];
  shotLists: ShotList[];
}

// Which destination kinds a project type delivers to. Design has none: its
// deliverable is a design SVG in the maker's library.
const KINDS: Record<ProjectType, DestinationKind[]> = {
  design: [],
  "listing-kit": ["sale"],
  content: ["content"],
  launch: ["sale", "content"],
};

export function destinationsFor(
  type: ProjectType,
  destinations: DestinationProfile[],
): DestinationProfile[] {
  return destinations.filter((d) => KINDS[type].includes(d.kind));
}

// The shot list a project type uses on a destination: the first one that
// targets it and lists the type. Editor-only presets list no types.
export function shotListFor(
  destinationId: string,
  type: ProjectType,
  shotLists: ShotList[],
): ShotList | undefined {
  return shotLists.find(
    (l) => l.destinationId === destinationId && l.projectTypes.includes(type),
  );
}

// The destinations the New project flow offers for a type: the right kind and
// a shot list for that type on it.
export function offeredDestinations(
  type: ProjectType,
  catalog: Catalog,
): DestinationProfile[] {
  return destinationsFor(type, catalog.destinations).filter((d) =>
    shotListFor(d.id, type, catalog.shotLists),
  );
}

// An exact slot that has nothing to show for this product is left out of the
// plan: "how to personalize" for a product with no wording lines, the colour
// sheet for a product sold in one colour.
const EXACT_RULES: Partial<Record<ExactKind, (product: Product) => boolean>> = {
  personalize: (p) => p.wording.length > 0,
  "colour-grid": (p) => p.colours.length > 1,
};

// Why the product takes no such frame, as the plan says it (DOGFOOD #57).
const EXACT_WHY: Partial<Record<ExactKind, string>> = {
  personalize: "it has no text lines, so nothing to personalize",
  "colour-grid": "it comes in one colour",
};

// The frames a destination's shot list has that the product does not take,
// each with why: a plan that drops one says so instead of shrinking quietly.
export function skippedFrames(
  destination: Pick<PlanDestination, "shotListId">,
  product: Product,
  shotLists: ShotList[],
): { label: string; why: string }[] {
  const list = shotLists.find((l) => l.id === destination.shotListId);
  return (list?.slots ?? []).flatMap((slot) =>
    ruled(slot) && slot.exact && !exactApplies(slot, product)
      ? [{ label: slot.label, why: EXACT_WHY[slot.exact] ?? "" }]
      : [],
  );
}

function exactApplies(
  slot: { fill: string; exact?: ExactKind },
  product: Product,
) {
  const rule = slot.exact ? EXACT_RULES[slot.exact] : undefined;
  return rule ? rule(product) : true;
}

// A slot the product decides: an exact slot with a rule.
const ruled = (slot: { fill: string; exact?: ExactKind }) =>
  slot.fill === "exact" &&
  slot.exact !== undefined &&
  !!EXACT_RULES[slot.exact];

export interface PlanChange {
  destinationId: string;
  key: string;
  label: string;
  change: "adds" | "removes";
}

// The plan a product's new version implies, keeping everything the maker
// did: only the exact slots the product decides are added (where the shot
// list puts them, never as the first photo, before the video) or removed; a
// destination never empties (its last slot is switched off instead). Scenes,
// the video, what is switched off, the knobs, approvals, the order and the
// listing stay. When a slot that is on comes or goes, the destination's
// photos renumber, so a delivery is cleared and named in `redeliver`.
export function replan(
  plan: ProjectPlan,
  product: Product,
  shotLists: ShotList[],
): { plan: ProjectPlan; changes: PlanChange[]; redeliver: string[] } {
  const changes: PlanChange[] = [];
  const redeliver: string[] = [];
  const destinations = plan.destinations.map((d) => {
    const list = shotLists.find((l) => l.id === d.shotListId);
    if (!list) return d;
    const order = new Map(list.slots.map((s, i) => [s.key, i]));
    let renumbered = false;
    const live = fromLiveListing(d);
    let slots = d.slots.flatMap((s) => {
      if (!ruled(s) || exactApplies(s, product)) return [s];
      changes.push({
        destinationId: d.destinationId,
        key: s.key,
        label: s.label,
        change: "removes",
      });
      // A frame that replaced a live photo gives the photo its place back.
      if (s.before) return [livePhotoSlot(`live-${s.key}`, s.before)];
      if (!s.off) renumbered = true;
      return [];
    });
    if (slots.length === 0) {
      slots = d.slots.map((s) => ({ ...s, off: true }));
    }
    for (const listed of live ? [] : list.slots) {
      if (!ruled(listed) || !exactApplies(listed, product)) continue;
      if (slots.some((s) => s.key === listed.key)) continue;
      const at = order.get(listed.key) ?? 0;
      let i = slots.findIndex(
        (s) => s.fill === "video" || (order.get(s.key) ?? -1) > at,
      );
      if (i === -1) i = slots.length;
      if (i === 0 && slots.length > 0) i = 1;
      slots = [...slots.slice(0, i), PlanSlot.parse(listed), ...slots.slice(i)];
      changes.push({
        destinationId: d.destinationId,
        key: listed.key,
        label: listed.label,
        change: "adds",
      });
      renumbered = true;
    }
    if (renumbered && slots.some((s) => s.deliveredAt)) {
      redeliver.push(d.destinationId);
      slots = slots.map(({ deliveredAt: _d, ...s }) => s);
    }
    return { ...d, slots };
  });
  return {
    plan: ProjectPlan.parse({ ...plan, destinations }),
    changes,
    redeliver,
  };
}

export function planProject(input: {
  product: Product;
  type: ProjectType;
  destinationIds: string[];
  catalog: Catalog;
}): ProjectPlan {
  const { product, type, catalog } = input;
  const ids = [...new Set(input.destinationIds)];
  if (ids.length === 0) throw new Error("pick at least one destination");
  const allowed = destinationsFor(type, catalog.destinations);
  // A Launch makes each scene once (ROADMAP "Scene vs version"): a later
  // destination's scene with a role an earlier one already shows is that
  // scene again — shared as it is at the same aspect, else re-framed.
  const shown = new Map<string, { id: string; aspect?: string }>();
  return ProjectPlan.parse({
    destinations: ids.map((id) => {
      if (!allowed.some((d) => d.id === id)) {
        throw new Error(`destination "${id}" is not offered for ${type}`);
      }
      const list = shotListFor(id, type, catalog.shotLists);
      if (!list) throw new Error(`no shot list for ${type} on "${id}"`);
      // In the plan a version names its source's card, not a list key.
      const listed = list.slots
        .filter((s) => exactApplies(s, product))
        .map((s) =>
          s.versionOf ? { ...s, versionOf: slotCardId(id, s.versionOf) } : s,
        );
      const made = new Map<string, string>();
      const slots = listed.map((s) => {
        const from =
          type === "launch" && s.role && !s.versionOf && s.fill === "scene"
            ? shown.get(s.role)
            : undefined;
        if (!from) return s;
        made.set(slotCardId(id, s.key), from.id);
        const {
          knobs: _k,
          scene: _s,
          composition: _c,
          lighting: _l,
          ...rest
        } = s;
        return {
          ...rest,
          versionOf: from.id,
          ...(from.aspect === s.aspect ? { fill: "shared" as const } : {}),
        };
      });
      for (const s of listed) {
        if (
          s.role &&
          s.fill === "scene" &&
          !s.versionOf &&
          !shown.has(s.role)
        ) {
          shown.set(s.role, { id: slotCardId(id, s.key), aspect: s.aspect });
        }
      }
      return {
        destinationId: id,
        shotListId: list.id,
        // A version of a slot that is now another's re-frames that one.
        slots: slots.map((s) =>
          s.versionOf && made.has(s.versionOf)
            ? { ...s, versionOf: made.get(s.versionOf) }
            : s,
        ),
      };
    }),
  });
}

// A live listing's photo kept as it is.
function livePhotoSlot(
  key: string,
  photo: { url: string; aspect: string },
): PlanSlot {
  return PlanSlot.parse({
    key,
    label: "Your photo",
    purpose: "On the live listing now, kept as it is.",
    aspect: photo.aspect,
    fill: "photo",
    photo: photo.url,
  });
}

// A destination started from a live listing: its photos, and the frames that
// replace some of them. Only the maker adds frames to it.
export function fromLiveListing(destination: PlanDestination): boolean {
  return destination.slots.some((s) => s.fill === "photo" || s.before);
}

// The frames a live listing's photo can be replaced with: the Listing kit's
// shot list on that destination, every frame but the video, without the exact
// ones that have nothing to show for this product.
export function replacementFrames(
  product: Product,
  destinationId: string,
  catalog: Catalog,
): ShotList["slots"] {
  const list = shotListFor(destinationId, "listing-kit", catalog.shotLists);
  return (list?.slots ?? []).filter(
    (s) => s.fill !== "video" && exactApplies(s, product),
  );
}

// A Listing kit started from a live listing (P0-2, Luis 2026-10-26: not a
// fifth project type): the listing's photos in their order, each kept as it
// is or replaced, in its place, by one of the shot list's frames (each frame
// once). Only the replacing frames are made; the rest is delivered as it is.
export function planFromListing(input: {
  product: Product;
  destinationId: string;
  catalog: Catalog;
  listingUrl?: string;
  photos: LivePhoto[];
}): ProjectPlan {
  const { product, destinationId, catalog, photos } = input;
  if (photos.length === 0) throw new Error("add the listing's photos");
  if (photos.length > MAX_LIVE_PHOTOS) {
    throw new Error(`a listing shows at most ${MAX_LIVE_PHOTOS} photos`);
  }
  if (
    !destinationsFor("listing-kit", catalog.destinations).some(
      (d) => d.id === destinationId,
    )
  ) {
    throw new Error(`"${destinationId}" is not a sale destination`);
  }
  const list = shotListFor(destinationId, "listing-kit", catalog.shotLists);
  if (!list) throw new Error(`no listing kit shot list on "${destinationId}"`);
  const frames = new Map(
    replacementFrames(product, destinationId, catalog).map((s) => [s.key, s]),
  );
  const used = new Set<string>();
  const slots = photos.map((photo, i) => {
    const before = { url: photo.url, aspect: photo.aspect };
    if (!photo.replaceWith) return livePhotoSlot(`live-${i + 1}`, before);
    const frame = frames.get(photo.replaceWith);
    if (!frame) {
      throw new Error(
        `"${photo.replaceWith}" is not a frame this product can have on ${list.name}`,
      );
    }
    if (used.has(frame.key)) {
      throw new Error(`"${frame.label}" can replace one photo only`);
    }
    used.add(frame.key);
    return PlanSlot.parse({ ...frame, before });
  });
  if (used.size === 0) throw new Error("mark a photo to replace");
  return ProjectPlan.parse({
    destinations: [
      {
        destinationId,
        shotListId: list.id,
        slots,
        ...(input.listingUrl ? { listingUrl: input.listingUrl } : {}),
      },
    ],
  });
}

// Ids that tie a scene slot to its editor card and recipe. A card id is unique
// per project; the recipe id resolves by composing the shot list on its
// destination (see findRecipe in the app).
export const slotCardId = (destinationId: string, slotKey: string) =>
  `${destinationId}.${slotKey}`;

export const slotRecipeId = (shotListId: string, destinationId: string) =>
  `${shotListId}@${destinationId}`;

// "etsy.gift" -> { destinationId: "etsy", slotKey: "gift" } (destination ids
// carry no dot).
export function parseSlotCardId(id: string): SlotRef | null {
  const dot = id.indexOf(".");
  if (dot <= 0 || dot === id.length - 1) return null;
  return { destinationId: id.slice(0, dot), slotKey: id.slice(dot + 1) };
}

// The cards a plan may generate: its scene slots that are switched on.
export function sceneCardIds(plan: ProjectPlan): string[] {
  return plan.destinations.flatMap((d) =>
    d.slots
      .filter((s) => s.fill === "scene" && !s.off)
      .map((s) => slotCardId(d.destinationId, s.key)),
  );
}

// What the queue may run for a plan: its scenes and videos switched on.
export function generableCardIds(plan: ProjectPlan): string[] {
  return plan.destinations.flatMap((d) =>
    d.slots
      .filter((s) => (s.fill === "scene" || s.fill === "video") && !s.off)
      .map((s) => slotCardId(d.destinationId, s.key)),
  );
}

export interface VideoSettings {
  // The slot whose approved scene starts the video (null: none approved yet).
  from: string | null;
  startFrame: string | null;
  motion: VideoMotion;
  seconds: VideoSeconds;
  orientation: VideoOrientation;
  // The lengths the model renders (at its resolution) that the destination
  // accepts; for stills in motion, the lengths Kiln makes.
  allowed: VideoSeconds[];
  // Kiln makes it from the approved scenes, free (VideoChoice.stills).
  stills: boolean;
}

// A video slot's choices with their defaults: the start frame is the chosen
// slot's approved scene, else the first approved scene in photo order (photo 1
// when it is a scene); a static camera with a light change (a push-in pushed
// a product out of a 9:16 frame and morphed what stood beside it; the still
// camera kept every letter); 8 s, or the nearest length the card's model
// renders and the destination accepts (a saved 12 s from Sora reads as 8);
// vertical.
export function videoSettings(
  destination: PlanDestination,
  slot: PlanSlot,
  rules?: { minSec: number; maxSec: number },
  model?: { provider: string; model: string; resolution?: VideoResolution },
): VideoSettings {
  const choice: VideoChoice = slot.video ?? {};
  const scenes = destination.slots.filter(
    (s) => s.fill === "scene" && !s.off && s.approvedOutput,
  );
  const chosen = scenes.find((s) => s.key === choice.from) ?? scenes[0];
  const stills = choice.stills === true;
  const allowed = stills
    ? stillsSecondsFor(rules)
    : videoSecondsFor(rules, model);
  const seconds = snapSeconds(choice.seconds, allowed);
  return {
    from: chosen?.key ?? null,
    startFrame: chosen?.approvedOutput ?? null,
    motion: choice.motion ?? "light",
    seconds,
    orientation: choice.orientation ?? "portrait",
    allowed,
    stills,
  };
}

// The videos a plan renders, each at its slot's length, priced on `model`:
// what the plan's estimate adds to its scenes. `usd` is null when the model
// has no pinned price for a length it would render.
export function planVideos(
  plan: ProjectPlan,
  destinations: DestinationProfile[],
  model: { provider: string; model: string; resolution?: VideoResolution },
  off: string[] = [],
): { count: number; seconds: number[]; usd: number | null } {
  const seconds = plan.destinations.flatMap((d) => {
    const profile = destinations.find((p) => p.id === d.destinationId);
    return d.slots
      .filter(
        (s) =>
          s.fill === "video" &&
          !s.off &&
          !off.includes(slotCardId(d.destinationId, s.key)),
      )
      .map((s) => videoSettings(d, s, profile?.video, model).seconds);
  });
  const prices = seconds.map((s) => estimateVideo(model, s));
  const usd = prices.some((p) => p === null)
    ? null
    : Math.round(prices.reduce<number>((t, p) => t + (p ?? 0), 0) * 100) / 100;
  return { count: seconds.length, seconds, usd };
}

// Change a video slot's choices (only the fields given).
export function withVideoChoice(
  plan: ProjectPlan,
  ref: SlotRef,
  choice: VideoChoice,
): ProjectPlan {
  return updateSlot(plan, ref, (slot) => {
    if (slot.fill !== "video") throw new Error("not a video slot");
    return { ...slot, video: { ...slot.video, ...choice } };
  });
}

// Add the destination's video slot to a plan made before video existed (the
// plan is a snapshot of its shot list). Null when the shot list has no video
// slot or the plan already has one.
export function addVideoSlot(
  plan: ProjectPlan,
  destinationId: string,
  shotLists: ShotList[],
): { plan: ProjectPlan; slot: PlanSlot } | null {
  const destination = plan.destinations.find(
    (d) => d.destinationId === destinationId,
  );
  if (!destination || destination.slots.some((s) => s.fill === "video")) {
    return null;
  }
  const list = shotLists.find((l) => l.id === destination.shotListId);
  const video = list?.slots.find((s) => s.fill === "video");
  if (!video) return null;
  const slot = PlanSlot.parse(video);
  return {
    slot,
    plan: {
      ...plan,
      destinations: plan.destinations.map((d) =>
        d === destination ? { ...d, slots: [...d.slots, slot] } : d,
      ),
    },
  };
}

export function parseSlotRecipeId(
  id: string,
): { shotListId: string; destinationId: string } | null {
  const [shotListId, destinationId, ...rest] = id.split("@");
  return shotListId && destinationId && rest.length === 0
    ? { shotListId, destinationId }
    : null;
}

export interface CardLike {
  status: "draft" | "rendering" | "done" | "error";
  outputs: string[];
  // What it renders on (a video's model and resolution decide its lengths).
  model?: { provider: string; model: string; resolution?: VideoResolution };
}

export interface SlotView {
  state: SlotState;
  failed: boolean;
  // Why the last try failed (the provider's words), when it did.
  error?: string;
  // Queued or running in the background generation queue.
  inBatch?: boolean;
}

export interface JobLike {
  status: "queued" | "running" | "done" | "failed" | "canceled";
  attempt: number;
  error?: string;
  // After a move down its route: the model it ran on, from which, and why.
  ranOn?: { label: string; from: string; reason: string };
}

// The state the board shows for a slot, from its card and its latest job. A
// job in the queue drives the state (queued / generating, and retrying on its
// second attempt); a failed job only flags the slot when there is no usable
// output, so a failed re-roll leaves an approved or reviewable output as it
// was. "delivered" needs Deliver.
export function slotState(
  slot: PlanSlot,
  card?: CardLike,
  job?: JobLike,
): SlotView {
  if (slot.off) return { state: "off", failed: false };
  if (slot.fill === "exact") {
    return { state: slot.deliveredAt ? "delivered" : "exact", failed: false };
  }
  if (slot.fill === "photo") {
    return { state: slot.deliveredAt ? "delivered" : "kept", failed: false };
  }
  // A shared frame follows its source: ready once that scene is approved.
  if (slot.fill === "shared") {
    if (!slot.approvedOutput) return { state: "queued", failed: false };
    return {
      state: slot.deliveredAt ? "delivered" : "approved",
      failed: false,
    };
  }
  if (job?.status === "running") {
    return {
      state: job.attempt >= 2 ? "retrying" : "generating",
      failed: false,
      inBatch: true,
    };
  }
  if (job?.status === "queued") {
    return {
      state: job.attempt >= 1 ? "retrying" : "queued",
      failed: false,
      inBatch: true,
    };
  }
  const jobFailed = job?.status === "failed";
  const why = jobFailed && job?.error ? { error: job.error } : {};
  if (!card || card.status === "draft") {
    return { state: "queued", failed: jobFailed, ...why };
  }
  if (card.status === "rendering")
    return { state: "generating", failed: false };
  const output = card.outputs[0];
  if (card.status === "error" || !output) {
    return { state: "queued", failed: true, ...why };
  }
  if (slot.approvedOutput !== output) {
    return { state: "to-review", failed: false };
  }
  return { state: slot.deliveredAt ? "delivered" : "approved", failed: false };
}

export interface SlotRef {
  destinationId: string;
  slotKey: string;
}

// Why a slot change was refused, in words a caller can show: no such slot,
// a change the slot does not take, or a newer take than the one the caller
// checked (the HTTP API answers 404, 422 and 409).
export class SlotRefusal extends Error {
  constructor(
    readonly kind: "missing" | "refused" | "stale",
    message: string,
  ) {
    super(message);
    this.name = "SlotRefusal";
  }
}

// Approve the output a scene slot's card shows now. Refuses anything but a
// finished card with a real output; re-rolling the card later un-approves it
// (the approved output no longer matches). A new approval is not delivered
// yet, so it clears the delivery stamp.
export function approveSlot(
  plan: ProjectPlan,
  ref: SlotRef,
  card: CardLike | undefined,
): ProjectPlan {
  const output = card?.outputs[0];
  const approved = updateSlot(plan, ref, (slot) => {
    if (slot.fill === "exact")
      throw new SlotRefusal("refused", "exact slots need no approval");
    if (slot.fill === "photo") {
      throw new SlotRefusal("refused", "your own photo needs no approval");
    }
    if (slot.fill === "shared") {
      throw new SlotRefusal(
        "refused",
        "a shared frame follows the scene it repeats",
      );
    }
    if (card?.status !== "done" || !output) {
      throw new SlotRefusal(
        "refused",
        "nothing to approve: the slot has no finished output",
      );
    }
    const { deliveredAt: _d, ...rest } = slot;
    return { ...rest, approvedOutput: output };
  });
  return withShared(approved, ref, output);
}

export function unapproveSlot(plan: ProjectPlan, ref: SlotRef): ProjectPlan {
  return withShared(
    updateSlot(
      plan,
      ref,
      ({ approvedOutput: _a, deliveredAt: _d, ...slot }) => slot,
    ),
    ref,
    undefined,
  );
}

// The shared frames of a scene carry its approval: the same output, or none
// once it is withdrawn (either way not delivered yet).
function withShared(
  plan: ProjectPlan,
  ref: SlotRef,
  output: string | undefined,
): ProjectPlan {
  const source = slotCardId(ref.destinationId, ref.slotKey);
  return {
    ...plan,
    destinations: plan.destinations.map((d) => ({
      ...d,
      slots: d.slots.map((s) => {
        if (s.fill !== "shared" || s.versionOf !== source) return s;
        const { approvedOutput: _a, deliveredAt: _d, ...rest } = s;
        return output ? { ...rest, approvedOutput: output } : rest;
      }),
    })),
  };
}

// The slot a version re-frames or a shared frame repeats, with where it is.
export function versionSource(
  plan: ProjectPlan,
  slot: Pick<PlanSlot, "versionOf">,
): { destinationId: string; slot: PlanSlot } | null {
  const ref = slot.versionOf ? parseSlotCardId(slot.versionOf) : null;
  if (!ref) return null;
  const source = plan.destinations
    .find((d) => d.destinationId === ref.destinationId)
    ?.slots.find((s) => s.key === ref.slotKey);
  return source ? { destinationId: ref.destinationId, slot: source } : null;
}

export const SlotMove = z.enum(["first", "earlier", "later"]);
export type SlotMove = z.infer<typeof SlotMove>;

// Reorder a destination's slots (the order is the photo order: the first is
// the listing's thumbnail). "first" puts the slot first; "earlier" / "later"
// swap it with the nearest slot switched on before / after it, so switched-off
// slots never take a turn. A video is not a photo: it never moves and is
// stepped over. A move with nowhere to go returns the plan as is; a real move
// renumbers the photos, so the destination's last export no longer matches
// and its delivery stamps are cleared.
export function moveSlot(
  plan: ProjectPlan,
  ref: SlotRef,
  move: SlotMove,
): ProjectPlan {
  return {
    ...plan,
    destinations: plan.destinations.map((d) => {
      if (d.destinationId !== ref.destinationId) return d;
      const from = d.slots.findIndex((s) => s.key === ref.slotKey);
      if (from < 0) {
        throw new SlotRefusal(
          "missing",
          `no slot "${ref.slotKey}" on "${ref.destinationId}"`,
        );
      }
      const slots = [...d.slots];
      if (slots[from].fill === "video") return d;
      if (move === "first") {
        if (from === 0) return d;
        const [slot] = slots.splice(from, 1);
        slots.unshift(slot);
      } else {
        const step = move === "earlier" ? -1 : 1;
        let to = from + step;
        while (
          to >= 0 &&
          to < slots.length &&
          (slots[to].off || slots[to].fill === "video")
        )
          to += step;
        if (to < 0 || to >= slots.length) return d;
        [slots[from], slots[to]] = [slots[to], slots[from]];
      }
      return {
        ...d,
        slots: slots.map(({ deliveredAt: _d, ...slot }) => slot),
      };
    }),
  };
}

// What keeps a destination from being delivered: the slots switched on that
// are not ready (an exact frame always is; a scene once its current output is
// approved; the maker's own photo always is). A scene's text layer is drawn
// over it at export, so it holds nothing up.
export function deliveryBlockers(
  destination: PlanDestination,
  cardOf: (slotKey: string) => CardLike | undefined,
): { notReady: string[] } {
  const on = destination.slots.filter((s) => !s.off);
  const ready = (s: PlanSlot) =>
    ["exact", "kept", "approved", "delivered"].includes(
      slotState(s, cardOf(s.key)).state,
    );
  return {
    notReady: on.filter((s) => !ready(s)).map((s) => s.label),
  };
}

// Stamp the slots an export delivered. A scene is stamped only if the output
// it exported is still the approved one (an approval may land meanwhile).
export function withDelivered(
  plan: ProjectPlan,
  destinationId: string,
  delivered: { key: string; approvedOutput?: string }[],
  at: string,
): ProjectPlan {
  const byKey = new Map(delivered.map((d) => [d.key, d]));
  return {
    ...plan,
    destinations: plan.destinations.map((d) =>
      d.destinationId !== destinationId
        ? d
        : {
            ...d,
            slots: d.slots.map((s) => {
              const done = byKey.get(s.key);
              if (!done || s.off) return s;
              if (
                s.fill !== "exact" &&
                s.fill !== "photo" &&
                (!s.approvedOutput || s.approvedOutput !== done.approvedOutput)
              ) {
                return s;
              }
              return { ...s, deliveredAt: at };
            }),
          },
    ),
  };
}

// Save a destination's listing text.
export function withListing(
  plan: ProjectPlan,
  destinationId: string,
  listing: ListingText,
): ProjectPlan {
  if (!plan.destinations.some((d) => d.destinationId === destinationId)) {
    throw new Error(`"${destinationId}" is not a destination of this plan`);
  }
  return {
    ...plan,
    destinations: plan.destinations.map((d) =>
      d.destinationId === destinationId ? { ...d, listing } : d,
    ),
  };
}

// The market brief of one destination, or none.
export function withBrief(
  plan: ProjectPlan,
  destinationId: string,
  brief: MarketBrief | undefined,
): ProjectPlan {
  if (!plan.destinations.some((d) => d.destinationId === destinationId)) {
    throw new Error(`"${destinationId}" is not a destination of this plan`);
  }
  return {
    ...plan,
    destinations: plan.destinations.map((d) => {
      if (d.destinationId !== destinationId) return d;
      const { brief: _old, ...rest } = d;
      return brief ? { ...rest, brief } : rest;
    }),
  };
}

function withDestination(
  plan: ProjectPlan,
  destinationId: string,
  change: (d: PlanDestination) => PlanDestination,
): ProjectPlan {
  if (!plan.destinations.some((d) => d.destinationId === destinationId)) {
    throw new Error(`"${destinationId}" is not a destination of this plan`);
  }
  return {
    ...plan,
    destinations: plan.destinations.map((d) =>
      d.destinationId === destinationId ? change(d) : d,
    ),
  };
}

// The live listing a destination's photos went to, or none (null). Kiln
// keeps the address and never opens it.
export function withListingUrl(
  plan: ProjectPlan,
  destinationId: string,
  url: string | null,
): ProjectPlan {
  return withDestination(plan, destinationId, (d) => {
    const { listingUrl: _old, ...rest } = d;
    return url ? { ...rest, listingUrl: ListingUrl.parse(url) } : rest;
  });
}

function withResults(
  plan: ProjectPlan,
  destinationId: string,
  change: (results: ListingResults) => ListingResults,
): ProjectPlan {
  return withDestination(plan, destinationId, (d) => ({
    ...d,
    results: ListingResults.parse(change(d.results ?? { reads: {} })),
  }));
}

// One read of the listing's numbers, or none (null).
export function withRead(
  plan: ProjectPlan,
  destinationId: string,
  key: ReadKey,
  read: ListingRead | null,
): ProjectPlan {
  return withResults(plan, destinationId, (r) => {
    const { [key]: _old, ...reads } = r.reads;
    return { ...r, reads: read ? { ...reads, [key]: read } : reads };
  });
}

// The day the new photos went up, or back to the day of the last delivery
// (null).
export function withLiveOn(
  plan: ProjectPlan,
  destinationId: string,
  liveOn: string | null,
): ProjectPlan {
  return withResults(plan, destinationId, ({ liveOn: _old, ...r }) =>
    liveOn ? { ...r, liveOn } : r,
  );
}

// Follow the listing's numbers, or stop (no read is due).
export function withFollowing(
  plan: ProjectPlan,
  destinationId: string,
  following: boolean,
): ProjectPlan {
  return withResults(plan, destinationId, ({ stopped: _old, ...r }) =>
    following ? r : { ...r, stopped: true },
  );
}

// The product seen from a little above, drawn beside the project's reference,
// or none (null).
export function withThreeQuarter(
  plan: ProjectPlan,
  view: ThreeQuarterView | null,
): ProjectPlan {
  const { threeQuarter: _old, ...kept } = plan.references ?? {};
  const references = view ? { ...kept, threeQuarter: view } : kept;
  const { references: _references, ...rest } = plan;
  return Object.keys(references).length > 0 ? { ...rest, references } : rest;
}

// A scene slot's own colour and style, or back to the project's (none). A
// version re-frames its source and takes the source's.
export function withSlotLook(
  plan: ProjectPlan,
  ref: SlotRef,
  look: Look | undefined,
): ProjectPlan {
  return updateSlot(plan, ref, ({ look: _old, ...slot }) => {
    if (slot.fill !== "scene" || slot.versionOf) {
      throw new Error("only a scene takes a colour and style of its own");
    }
    return look && (look.colour || look.style) ? { ...slot, look } : slot;
  });
}

// A scene slot's own place, or back to the product's places (null). A
// hero that offers a setting stands in its place once it has one.
export function withSlotPlace(
  plan: ProjectPlan,
  ref: SlotRef,
  place: string | null,
): ProjectPlan {
  return updateSlot(plan, ref, ({ place: _old, ...slot }) => {
    if (slot.fill !== "scene") throw new Error("not a scene slot");
    const own = place?.trim();
    if (!own) return slot;
    if (own.length > 160) throw new Error("a place is at most 160 characters");
    if (slot.knobs?.setting === undefined) return { ...slot, place: own };
    return {
      ...slot,
      place: own,
      tuned: { ...slot.tuned, setting: "place" },
    };
  });
}

// Switch a slot off or back on. An approval survives the round trip.
export function withSlotOff(
  plan: ProjectPlan,
  ref: SlotRef,
  off: boolean,
): ProjectPlan {
  return updateSlot(plan, ref, ({ off: _o, ...slot }) =>
    off ? { ...slot, off: true } : slot,
  );
}

// Set one of a scene slot's knobs, or return it to the slot's default (null).
// A slot planned before knobs, or one without this knob, refuses.
export function withSlotTuning(
  plan: ProjectPlan,
  ref: SlotRef,
  choice: KnobChoice,
): ProjectPlan {
  return updateSlot(plan, ref, ({ tuned: before, ...slot }) => {
    if (slot.fill !== "scene") throw new Error("not a scene slot");
    if (!slot.knobs) throw new Error("this scene was planned before knobs");
    if (slot.knobs[choice.knob] === undefined) {
      throw new Error(`this scene has no ${choice.knob} knob`);
    }
    const { [choice.knob]: _old, ...rest } = before ?? {};
    const tuned =
      choice.stop === null ? rest : { ...rest, [choice.knob]: choice.stop };
    return Object.keys(tuned).length > 0 ? { ...slot, tuned } : slot;
  });
}

function updateSlot(
  plan: ProjectPlan,
  ref: SlotRef,
  update: (slot: PlanSlot) => PlanSlot,
): ProjectPlan {
  let found = false;
  const destinations = plan.destinations.map((d) =>
    d.destinationId !== ref.destinationId
      ? d
      : {
          ...d,
          slots: d.slots.map((s) => {
            if (s.key !== ref.slotKey) return s;
            found = true;
            return update(s);
          }),
        },
  );
  if (!found) {
    throw new SlotRefusal(
      "missing",
      `no slot "${ref.slotKey}" on "${ref.destinationId}"`,
    );
  }
  return { ...plan, destinations };
}

// The deliverable's size: the slots that are on, exact vs scene vs video vs
// the maker's own photos, and how many the maker switched off.
export function planCounts(plan: ProjectPlan): {
  exact: number;
  scene: number;
  video: number;
  photo: number;
  shared: number;
  off: number;
} {
  const slots = plan.destinations.flatMap((d) => d.slots);
  const on = slots.filter((s) => !s.off);
  const count = (fill: PlanSlot["fill"]) =>
    on.filter((s) => s.fill === fill).length;
  return {
    exact: count("exact"),
    scene: count("scene"),
    video: count("video"),
    photo: count("photo"),
    shared: count("shared"),
    off: slots.length - on.length,
  };
}
