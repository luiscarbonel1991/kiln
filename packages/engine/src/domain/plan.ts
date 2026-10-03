import { z } from "zod";
import type { DestinationKind, DestinationProfile } from "@/domain/destination";
import type { Product } from "@/domain/product";
import type { ProjectType } from "@/domain/project";
import {
  exactKindMatchesFill,
  type ShotList,
  ShotSlotFields,
} from "@/domain/shot-list";

// A project's plan (ROADMAP "Experience design"): one storyboard row per
// destination, one slot per frame of its shot list, snapshotted at Start so the
// project stays stable when seeds change. Board-owned state (approval, delivery)
// lives here, never on the editor's cards — autosave rewrites the cards.
export const PlanSlot = ShotSlotFields.extend({
  approvedOutput: z.string().min(1).optional(),
  deliveredAt: z.string().optional(),
}).refine(exactKindMatchesFill.check, {
  message: exactKindMatchesFill.message,
});
export type PlanSlot = z.infer<typeof PlanSlot>;

export const PlanDestination = z.object({
  destinationId: z.string().min(1),
  shotListId: z.string().min(1),
  slots: z.array(PlanSlot).min(1),
});
export type PlanDestination = z.infer<typeof PlanDestination>;

export const ProjectPlan = z.object({
  destinations: z.array(PlanDestination).min(1),
});
export type ProjectPlan = z.infer<typeof ProjectPlan>;

export const SlotState = z.enum([
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

// An exact slot that has nothing to show for this product is left out of the
// plan (e.g. "how to personalize" for a product with no wording lines).
function exactApplies(slot: ShotList["slots"][number], product: Product) {
  if (slot.exact === "personalize") return product.wording.length > 0;
  return true;
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

export function parseSlotRecipeId(
  id: string,
): { shotListId: string; destinationId: string } | null {
  const [shotListId, destinationId, ...rest] = id.split("@");
  return shotListId && destinationId && rest.length === 0
    ? { shotListId, destinationId }
    : null;
}

interface CardLike {
  status: "draft" | "rendering" | "done" | "error";
  outputs: string[];
}

export interface SlotView {
  state: SlotState;
  failed: boolean;
}

// The state the board shows for a slot. "retrying" belongs to the QC gate and
// is not produced until it exists; "delivered" needs Deliver.
export function slotState(slot: PlanSlot, card?: CardLike): SlotView {
  if (slot.fill === "exact") {
    return { state: slot.deliveredAt ? "delivered" : "exact", failed: false };
  }
  if (!card || card.status === "draft")
    return { state: "queued", failed: false };
  if (card.status === "rendering")
    return { state: "generating", failed: false };
  if (card.status === "error") return { state: "queued", failed: true };
  const output = card.outputs[0];
  if (!output) return { state: "queued", failed: true };
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
// (the approved output no longer matches).
export function approveSlot(
  plan: ProjectPlan,
  ref: SlotRef,
  card: CardLike | undefined,
): ProjectPlan {
  return updateSlot(plan, ref, (slot) => {
    if (slot.fill !== "scene") throw new Error("exact slots need no approval");
    const output = card?.outputs[0];
    if (card?.status !== "done" || !output) {
      throw new Error("nothing to approve: the slot has no finished output");
    }
    return { ...slot, approvedOutput: output };
  });
}

export function unapproveSlot(plan: ProjectPlan, ref: SlotRef): ProjectPlan {
  return updateSlot(plan, ref, ({ approvedOutput: _a, ...slot }) => slot);
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

export function planCounts(plan: ProjectPlan): {
  exact: number;
  scene: number;
} {
  const slots = plan.destinations.flatMap((d) => d.slots);
  const exact = slots.filter((s) => s.fill === "exact").length;
  return { exact, scene: slots.length - exact };
}
