import { z } from "zod";
import { ModelConfig } from "@/domain/model-config";

// Capabilities + ImageOp are domain data (client-safe). Re-exported here so the
// providers layer keeps one import surface.
export { Capabilities, type ImageOp } from "@/domain/capabilities";

export const GeneratedAsset = z.object({
  id: z.string(),
  url: z.string(),
  mime: z.string(),
});
export type GeneratedAsset = z.infer<typeof GeneratedAsset>;

export const GenerationResult = z.object({
  assets: z.array(GeneratedAsset),
  provider: z.string(),
  model: z.string(),
});
export type GenerationResult = z.infer<typeof GenerationResult>;

// text -> image (chat base creation)
export const ImageGenInput = z.object({
  prompt: z.string(),
  model: ModelConfig,
});
export type ImageGenInput = z.infer<typeof ImageGenInput>;

// base + prompt (+ extra reference images) -> image (variants)
export const ImageEditInput = z.object({
  masterAssetUrl: z.string(),
  prompt: z.string(),
  imageInputs: z.array(z.string()).default([]),
  negative: z.string().default(""),
  model: ModelConfig,
});
export type ImageEditInput = z.infer<typeof ImageEditInput>;

// multi-image -> image
export const ImageComposeInput = z.object({
  prompt: z.string(),
  imageInputs: z.array(z.string()).min(2),
  negative: z.string().default(""),
  model: ModelConfig,
});
export type ImageComposeInput = z.infer<typeof ImageComposeInput>;

// start frame + prompt -> video (image-to-video / promote-to-video)
export const AnimateInput = z.object({
  startFrameAssetId: z.string(),
  prompt: z.string(),
  motion: z.string(),
  durationSec: z.number(),
});
export type AnimateInput = z.infer<typeof AnimateInput>;
