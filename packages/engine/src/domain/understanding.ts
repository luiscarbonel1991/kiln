import { z } from "zod";

export const BaseUnderstanding = z.object({
  subject: z.string(),
  // Enriched product context (default "" so older 6-field snapshots still parse):
  // productType drives scene appropriateness, useContext tells the ArtDirector
  // where the product actually lives, and sceneProps names anything in the photo
  // that is NOT the product (a mount/hand/stand) so the hero can exclude it.
  productType: z.string().default(""),
  useContext: z.string().default(""),
  sceneProps: z.string().default(""),
  // What the product must never be rendered as (its treatment's opposite:
  // "flat printed lettering" for raised letters); joins the negative prompt.
  // Default "" so older snapshots still parse.
  avoid: z.string().default(""),
  materials: z.string(),
  lighting: z.string(),
  composition: z.string(),
  mood: z.string(),
  palette: z.array(z.string()),
});
export type BaseUnderstanding = z.infer<typeof BaseUnderstanding>;
