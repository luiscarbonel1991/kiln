import { z } from "zod";
import type { CameraStop, SceneKnobs } from "@/domain/scene-knobs";

// The image a scene edits (ROADMAP 2026-10-20, the view from above). The model
// keeps the reference's point of view, so a product with a part lying flat
// (a plate on a base) drawn from the front comes out as a strip of base. Kiln
// draws the same product seen from a little above, locally and for free, and
// a scene whose camera looks down edits that view instead. Checked on 10/27:
// the base in front of the plate went from 6-8 % of the plate's height to
// 21-24 %.

export const ThreeQuarterView = z.object({
  assetUrl: z.string().min(1),
  angleDeg: z.number().positive().max(80),
  // The front reference it was drawn beside: it applies while the project's
  // reference is still that one (a reference the maker uploads replaces both).
  front: z.string().min(1),
});
export type ThreeQuarterView = z.infer<typeof ThreeQuarterView>;

export const PlanReferences = z.object({
  threeQuarter: ThreeQuarterView.optional(),
});
export type PlanReferences = z.infer<typeof PlanReferences>;

// The view from above, while the project's reference is the front it was
// drawn beside; else null.
export function threeQuarterFor(
  references: PlanReferences | undefined,
  masterUrl: string | undefined,
): ThreeQuarterView | null {
  const view = references?.threeQuarter;
  return view && masterUrl && view.front === masterUrl ? view : null;
}

// Kiln's pick for a scene that offers the camera: a little above, once the
// view from above exists, so the top of the part lying flat shows. The
// maker's own stop still wins.
export function kilnPick(
  knobs: SceneKnobs | undefined,
  view: ThreeQuarterView | null,
): SceneKnobs {
  return view && knobs?.camera !== undefined ? { camera: "above" } : {};
}

export const looksDown = (camera: CameraStop | undefined) =>
  camera === "above" || camera === "overhead";

// The reference a scene edits: the view from above when its camera looks
// down, else the front.
export function sceneReference<M extends { assetUrl: string }>(
  camera: CameraStop | undefined,
  master: M,
  view: ThreeQuarterView | null,
): M {
  return view && looksDown(camera)
    ? { ...master, assetUrl: view.assetUrl }
    : master;
}
