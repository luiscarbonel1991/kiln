import { z } from "zod";
import {
  ImageQuality,
  ImageSize,
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
  // Images: the size asked for (1k when absent); the queue asks 2k for a
  // destination that needs it (image-size.ts).
  size: ImageSize.optional(),
  // Video: the resolution rendered (DEFAULT_VIDEO_RESOLUTION when absent).
  resolution: VideoResolution.optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;
