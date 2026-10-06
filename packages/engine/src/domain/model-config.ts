import { z } from "zod";
import {
  ImageQuality,
  ProviderId,
  VideoResolution,
} from "@/domain/model-defaults";

export const ModelConfig = z.object({
  provider: ProviderId,
  model: z.string(),
  aspect: z.string().default("4:5"),
  guidance: z.number().default(7.5),
  strength: z.number().default(0.65),
  seed: z.number().optional(),
  // OpenAI images: the quality sent (DEFAULT_IMAGE_QUALITY when absent).
  quality: ImageQuality.optional(),
  // Video: the resolution rendered (DEFAULT_VIDEO_RESOLUTION when absent).
  resolution: VideoResolution.optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;
