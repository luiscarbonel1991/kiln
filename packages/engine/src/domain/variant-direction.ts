import { z } from "zod";

// A per-variant creative plan from the ArtDirector: a distinct scene (where the
// product is shown/used), composition, and lighting for one direction. These
// diversify the four cards so they aren't four copies — the product (subject) and
// palette stay shared; the scene/composition/lighting differ per direction.
export const VariantDirection = z.object({
  direction: z.string(),
  scene: z.string(),
  composition: z.string(),
  lighting: z.string(),
});
export type VariantDirection = z.infer<typeof VariantDirection>;
