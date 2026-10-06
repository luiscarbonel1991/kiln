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

// Token usage reported by the provider: what a finished call actually cost
// (domain costFromUsage). `outputTokens` is the model's main output (an image
// model's image, a text model's text and thinking); `outputTextTokens` is the
// text and thinking an image model writes beside its image.
export const GenerationUsage = z.object({
  inputTextTokens: z.number().int().min(0),
  inputImageTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  outputTextTokens: z.number().int().min(0).optional(),
});
export type GenerationUsage = z.infer<typeof GenerationUsage>;

export const GenerationResult = z.object({
  assets: z.array(GeneratedAsset),
  provider: z.string(),
  model: z.string(),
  usage: GenerationUsage.optional(),
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

// start frame + prompt -> video (image-to-video / promote-to-video). `model`
// carries the card's provider, video model and resolution; `negative` is what
// the clip must never show (sent where the model takes one).
export const AnimateInput = z.object({
  startFrameAssetId: z.string(),
  prompt: z.string(),
  motion: z.string(),
  durationSec: z.number(),
  negative: z.string().optional(),
  model: ModelConfig,
});
export type AnimateInput = z.infer<typeof AnimateInput>;
