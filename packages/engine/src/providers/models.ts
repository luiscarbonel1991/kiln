import {
  DEFAULT_MODEL_IDS,
  IMAGE_MODEL_CATALOG,
  VIDEO_MODEL_CATALOG,
} from "@/domain/model-defaults";
import { env } from "../env";

// Model IDs: client-safe defaults (DEFAULT_MODEL_IDS) with build-time env overrides.
export const MODELS = {
  google: {
    image: env.GOOGLE_IMAGE_MODEL ?? DEFAULT_MODEL_IDS.google.image,
    vision: env.GOOGLE_VISION_MODEL ?? DEFAULT_MODEL_IDS.google.vision,
    video: env.GOOGLE_VIDEO_MODEL ?? DEFAULT_MODEL_IDS.google.video,
  },
  openai: {
    image: env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL_IDS.openai.image,
    video: env.OPENAI_VIDEO_MODEL ?? DEFAULT_MODEL_IDS.openai.video,
  },
} as const;

// A card's image model id is client-supplied (Server Functions are POST-reachable),
// so it only reaches a provider when it's in the curated catalog for that provider
// (or is the env-configured default); anything else falls back to the default.
export function resolveImageModel(
  provider: "google" | "openai",
  requested: string | undefined,
): string {
  const fallback = MODELS[provider].image;
  if (!requested || requested === fallback) return fallback;
  const allowed = IMAGE_MODEL_CATALOG.some(
    (m) => m.provider === provider && m.id === requested,
  );
  return allowed ? requested : fallback;
}

// Same guard for the video catalog (Veo variants + Sora).
export function resolveVideoModel(
  provider: "google" | "openai",
  requested: string | undefined,
): string {
  const fallback = MODELS[provider].video;
  if (!requested || requested === fallback) return fallback;
  const allowed = VIDEO_MODEL_CATALOG.some(
    (m) => m.provider === provider && m.id === requested,
  );
  return allowed ? requested : fallback;
}
