import type { MasterAsset } from "@/domain/master-asset";
import {
  type PlanSlot,
  type ProjectPlan,
  parseSlotCardId,
} from "@/domain/plan";
import { type CameraStop, effectiveKnobs } from "@/domain/scene-knobs";
import {
  kilnPick,
  sceneReference,
  threeQuarterFor,
} from "@/domain/scene-reference";

// The camera a scene slot applies: its default, Kiln's pick (a little above,
// once a view from above applies), or the maker's own stop.
export function slotCamera(
  plan: ProjectPlan,
  slot: PlanSlot,
  masterUrl: string | undefined,
): CameraStop | undefined {
  if (!slot.knobs) return undefined;
  const view = threeQuarterFor(plan.references, masterUrl);
  return effectiveKnobs(slot.knobs, slot.tuned, kilnPick(slot.knobs, view))
    .stops.camera;
}

// The reference a scene card edits: Kiln's view from above when its slot's
// camera looks down and the view applies, else the project's reference.
export function cardReference(
  plan: ProjectPlan,
  cardId: string,
  master: MasterAsset,
): MasterAsset {
  const ref = parseSlotCardId(cardId);
  const slot = plan.destinations
    .find((d) => d.destinationId === ref?.destinationId)
    ?.slots.find((s) => s.key === ref?.slotKey);
  if (!slot || slot.fill !== "scene") return master;
  return sceneReference(
    slotCamera(plan, slot, master.assetUrl),
    master,
    threeQuarterFor(plan.references, master.assetUrl),
  );
}
