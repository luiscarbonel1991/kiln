import { z } from "zod";

export const ModelConfig = z.object({
  provider: z.enum(["google", "openai"]),
  model: z.string(),
  aspect: z.string().default("4:5"),
  guidance: z.number().default(7.5),
  strength: z.number().default(0.65),
  seed: z.number().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;
