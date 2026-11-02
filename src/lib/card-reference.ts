import type { MasterAsset } from "@/domain/master-asset";
import {
  type PlanSlot,
  type ProjectPlan,
  parseSlotCardId,
} from "@/domain/plan";
import {
  lookReference,
  projectLook,
  slotLook,
  slotView,
} from "@/domain/plan-look";
import type { Product } from "@/domain/product";
import { sameLook } from "@/domain/product-look";
import { type CameraStop, effectiveKnobs } from "@/domain/scene-knobs";
import { kilnPick, sceneReference } from "@/domain/scene-reference";

// The camera a scene slot applies: its default, Kiln's pick (a little above,
// once a view from above applies), a kept lesson's, or the maker's own stop.
export function slotCamera(
  plan: ProjectPlan,
  slot: PlanSlot,
  masterUrl: string | undefined,
  product: Product,
): CameraStop | undefined {
  if (!slot.knobs) return undefined;
  const view = slotView(plan, slot, masterUrl, product);
  return effectiveKnobs(
    slot.knobs,
    slot.tuned,
    kilnPick(slot.knobs, view),
    slot.learned,
  ).stops.camera;
}

// The reference a scene card edits: the plate Kiln drew for its frame's own
// look (ROADMAP P2-9), else the project's reference; and of either, the view
// from above when its camera looks down and the view applies.
export function cardReference(
  plan: ProjectPlan,
  cardId: string,
  master: MasterAsset,
  product: Product,
): MasterAsset {
  const ref = parseSlotCardId(cardId);
  const slot = plan.destinations
    .find((d) => d.destinationId === ref?.destinationId)
    ?.slots.find((s) => s.key === ref?.slotKey);
  if (!slot || slot.fill !== "scene") return master;
  const look = slotLook(plan, slot, product);
  const own = sameLook(look, projectLook(plan, product))
    ? null
    : lookReference(plan, look);
  return sceneReference(
    slotCamera(plan, slot, master.assetUrl, product),
    own ? { ...master, assetUrl: own.front } : master,
    slotView(plan, slot, master.assetUrl, product),
  );
}
