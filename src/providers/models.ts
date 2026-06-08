import { DEFAULT_MODEL_IDS } from "@/domain/model-defaults";
import { env } from "@/lib/env";

// Model IDs: client-safe defaults (DEFAULT_MODEL_IDS) with build-time env overrides.
export const MODELS = {
  google: {
    image: env.GOOGLE_IMAGE_MODEL ?? DEFAULT_MODEL_IDS.google.image,
    vision: env.GOOGLE_VISION_MODEL ?? DEFAULT_MODEL_IDS.google.vision,
    video: env.GOOGLE_VIDEO_MODEL ?? DEFAULT_MODEL_IDS.google.video,
  },
  openai: {
    image: env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL_IDS.openai.image,
  },
} as const;
