import { z } from "zod";
import type { DestinationKind, DestinationProfile } from "@/domain/destination";
import { ListingText } from "@/domain/listing";
import type { VideoResolution } from "@/domain/model-defaults";
import type { Product } from "@/domain/product";
import type { ProjectType } from "@/domain/project";
import { type KnobChoice, SavedKnobs } from "@/domain/scene-knobs";
import {
  type ExactKind,
  exactKindMatchesFill,
  type ShotList,
  ShotSlotFields,
} from "@/domain/shot-list";
import {
  snapSeconds,
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
}).refine(exactKindMatchesFill.check, {
  message: exactKindMatchesFill.message,
});
export type PlanSlot = z.infer<typeof PlanSlot>;

export const PlanDestination = z.object({
  destinationId: z.string().min(1),
  shotListId: z.string().min(1),
  slots: z.array(PlanSlot).min(1),
  // The listing text once saved (edited, or written by the text model); until
  // then the board shows the free draft from the spec.
  listing: ListingText.optional(),
});
export type PlanDestination = z.infer<typeof PlanDestination>;

export const ProjectPlan = z.object({
  destinations: z.array(PlanDestination).min(1),
});
export type ProjectPlan = z.infer<typeof ProjectPlan>;

export const SlotState = z.enum([
  "off",
  "exact",
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
    let slots = d.slots.flatMap((s) => {
      if (!ruled(s) || exactApplies(s, product)) return [s];
      changes.push({
        destinationId: d.destinationId,
        key: s.key,
        label: s.label,
        change: "removes",
      });
      if (!s.off) renumbered = true;
      return [];
    });
    if (slots.length === 0) {
      slots = d.slots.map((s) => ({ ...s, off: true }));
    }
    for (const listed of list.slots) {
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
  return ProjectPlan.parse({
    destinations: ids.map((id) => {
      if (!allowed.some((d) => d.id === id)) {
        throw new Error(`destination "${id}" is not offered for ${type}`);
      }
      const list = shotListFor(id, type, catalog.shotLists);
      if (!list) throw new Error(`no shot list for ${type} on "${id}"`);
      return {
        destinationId: id,
        shotListId: list.id,
        slots: list.slots.filter((s) => exactApplies(s, product)),
      };
    }),
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
      .filter((s) => s.fill !== "exact" && !s.off)
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
  // accepts.
  allowed: VideoSeconds[];
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
  const allowed = videoSecondsFor(rules, model);
  const seconds = snapSeconds(choice.seconds, allowed);
  return {
    from: chosen?.key ?? null,
    startFrame: chosen?.approvedOutput ?? null,
    motion: choice.motion ?? "light",
    seconds,
    orientation: choice.orientation ?? "portrait",
    allowed,
  };
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

interface JobLike {
  status: "queued" | "running" | "done" | "failed" | "canceled";
  attempt: number;
  error?: string;
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

// Approve the output a scene slot's card shows now. Refuses anything but a
// finished card with a real output; re-rolling the card later un-approves it
// (the approved output no longer matches). A new approval is not delivered
// yet, so it clears the delivery stamp.
export function approveSlot(
  plan: ProjectPlan,
  ref: SlotRef,
  card: CardLike | undefined,
): ProjectPlan {
  return updateSlot(plan, ref, (slot) => {
    if (slot.fill === "exact") throw new Error("exact slots need no approval");
    const output = card?.outputs[0];
    if (card?.status !== "done" || !output) {
      throw new Error("nothing to approve: the slot has no finished output");
    }
    const { deliveredAt: _d, ...rest } = slot;
    return { ...rest, approvedOutput: output };
  });
}

export function unapproveSlot(plan: ProjectPlan, ref: SlotRef): ProjectPlan {
  return updateSlot(
    plan,
    ref,
    ({ approvedOutput: _a, deliveredAt: _d, ...slot }) => slot,
  );
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
    destinations: plan.destinations.map((d) => {
      if (d.destinationId !== ref.destinationId) return d;
      const from = d.slots.findIndex((s) => s.key === ref.slotKey);
      if (from < 0) {
        throw new Error(`no slot "${ref.slotKey}" on "${ref.destinationId}"`);
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
// approved), and scenes that carry text on the image (composited at export
// later; none on a sale destination today).
export function deliveryBlockers(
  destination: PlanDestination,
  cardOf: (slotKey: string) => CardLike | undefined,
): { notReady: string[]; textOnScenes: string[] } {
  const on = destination.slots.filter((s) => !s.off);
  const ready = (s: PlanSlot) =>
    ["exact", "approved", "delivered"].includes(
      slotState(s, cardOf(s.key)).state,
    );
  return {
    notReady: on.filter((s) => !ready(s)).map((s) => s.label),
    textOnScenes: on
      .filter((s) => s.fill === "scene" && s.textTemplate)
      .map((s) => s.label),
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
    destinations: plan.destinations.map((d) =>
      d.destinationId === destinationId ? { ...d, listing } : d,
    ),
  };
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
    throw new Error(`no slot "${ref.slotKey}" on "${ref.destinationId}"`);
  }
  return { destinations };
}

// The deliverable's size: the slots that are on, exact vs scene vs video, and
// how many the maker switched off.
export function planCounts(plan: ProjectPlan): {
  exact: number;
  scene: number;
  video: number;
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
    off: slots.length - on.length,
  };
}
