import { z } from "zod";
import { Aspect } from "@/domain/destination";
import { ProjectType } from "@/domain/project";
import { SceneKnobs } from "@/domain/scene-knobs";

// Render style drives the prompt framing: "photographic" (a product photo) vs
// "line-art" (clean black strokes on white, for vector workflows).
export const RenderStyle = z.enum(["photographic", "line-art"]);
export type RenderStyle = z.infer<typeof RenderStyle>;

// How a slot gets filled. "exact" = rendered from the product spec (free,
// instant, never an image model); "scene" = staged by an image model.
// "exact" is drawn from the spec; "scene" is an image model's edit of the
// product; "video" animates an approved scene.
export const SlotFill = z.enum(["exact", "scene", "video"]);
export type SlotFill = z.infer<typeof SlotFill>;

export const ExactKind = z.enum([
  "colour-grid",
  "size-spec",
  "scale",
  "personalize",
  "text-card",
]);
export type ExactKind = z.infer<typeof ExactKind>;

// One frame of a deliverable: a buyer-decision job, not a photo style. `purpose`
// drives the ArtDirector and is shown to the maker; `textTemplate` is text a
// template draws on the frame (e.g. "{product.name}"), never the image model.
// A scene slot may write its own art direction (scene / composition /
// lighting); `{use}` in its scene takes the product's places of use and
// `{surface}` how a close look shows the product's treatment (see
// scene-direction.ts). Without them it leans the list's defaults to its purpose.
// `knobs` are the knobs a scene slot offers the maker, with its default stops
// (scene-knobs.ts); its prose then leaves what they say to them.
export const ShotSlotFields = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/, "kebab-case slot key"),
  label: z.string().min(1),
  purpose: z.string().min(1),
  aspect: Aspect.optional(),
  fill: SlotFill.default("scene"),
  exact: ExactKind.optional(),
  textTemplate: z.string().optional(),
  scene: z.string().min(1).optional(),
  composition: z.string().min(1).optional(),
  lighting: z.string().min(1).optional(),
  knobs: SceneKnobs.optional(),
});

export const exactKindMatchesFill = {
  check: (s: { fill: SlotFill; exact?: ExactKind }) =>
    (s.fill === "exact") === (s.exact !== undefined),
  message: "an exact slot names its exact kind; a scene slot does not",
};

export const ShotSlot = ShotSlotFields.refine(exactKindMatchesFill.check, {
  message: exactKindMatchesFill.message,
}).refine((s) => !s.knobs || s.fill === "scene", {
  message: "only a scene slot has knobs",
});
export type ShotSlot = z.infer<typeof ShotSlot>;

// An ordered list of slots for one destination (or none: a Design brief), plus
// the creative defaults its scenes share. `projectTypes` lists the project types
// whose plan uses it; [] = an editor preset only.
export const ShotList = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    destinationId: z.string().min(1).nullable(),
    projectTypes: z.array(ProjectType).default([]),
    style: RenderStyle.default("photographic"),
    fieldDefaults: z.record(z.string(), z.string()).default({}),
    preserve: z.array(z.string()).default([]),
    negative: z.array(z.string()).default([]),
    slots: z.array(ShotSlot).min(1),
  })
  .refine((l) => new Set(l.slots.map((s) => s.key)).size === l.slots.length, {
    message: "slot keys must be unique within a shot list",
  })
  .refine((l) => l.style !== "line-art" || l.slots.every((s) => !s.knobs), {
    message: "a line-art list has no knobs: it frames, it does not light",
  });
export type ShotList = z.infer<typeof ShotList>;

export function sceneSlots(list: ShotList): ShotSlot[] {
  return list.slots.filter((s) => s.fill === "scene");
}
