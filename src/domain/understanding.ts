import { z } from "zod";

export const BaseUnderstanding = z.object({
  subject: z.string(),
  materials: z.string(),
  lighting: z.string(),
  composition: z.string(),
  mood: z.string(),
  palette: z.array(z.string()),
});
export type BaseUnderstanding = z.infer<typeof BaseUnderstanding>;
