import { z } from "zod";

export const FieldSource = z.enum(["brand", "image", "recipe", "local"]);
export type FieldSource = z.infer<typeof FieldSource>;

export const Field = z.object({
  value: z.string(),
  source: FieldSource,
  locked: z.boolean(),
});
export type Field = z.infer<typeof Field>;
