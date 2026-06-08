import { z } from "zod";
import { Field } from "@/domain/field";
import { ModelConfig } from "@/domain/model-config";

export const Card = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  masterAssetId: z.string(),
  recipeId: z.string(),
  type: z.enum(["image", "video"]),
  direction: z.string(),
  fields: z.object({
    subject: Field,
    materials: Field,
    scene: Field,
    composition: Field,
    lighting: Field,
    mood: Field,
    palette: Field,
  }),
  references: z.array(z.string()).default([]),
  model: ModelConfig,
  video: z
    .object({
      durationSec: z.number(),
      motion: z.string(),
      startFrameAssetId: z.string().nullable(),
    })
    .optional(),
  promptOverride: z.string().optional(),
  // The traced SVG URL once a line-art card is vectorized (persisted).
  vectorUrl: z.string().optional(),
  outputs: z.array(z.string()).default([]),
  status: z.enum(["draft", "rendering", "done", "error"]).default("draft"),
});
export type Card = z.infer<typeof Card>;
