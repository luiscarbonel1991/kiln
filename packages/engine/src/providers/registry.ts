import type { Card } from "@/domain/card";
import { assertCapability, canUse } from "@/providers/capabilities";
import { googleArtDirector } from "@/providers/google/art-director";
import { googleImageProvider } from "@/providers/google/image";
import { googleVideoProvider } from "@/providers/google/video";
import { googleVisionProvider } from "@/providers/google/vision";
import type {
  ArtDirector,
  ImageProvider,
  ProviderId,
  VideoProvider,
  VisionProvider,
} from "@/providers/interfaces";
import { openaiImageProvider } from "@/providers/openai/image";
import { openaiVideoProvider } from "@/providers/openai/video";
import type { Capabilities } from "@/providers/types";

const IMAGE_PROVIDERS: Record<ProviderId, ImageProvider> = {
  google: googleImageProvider,
  openai: openaiImageProvider,
};

// Video: Veo (google) and Sora (openai), switchable per card like images.
const VIDEO_PROVIDERS: Partial<Record<ProviderId, VideoProvider>> = {
  google: googleVideoProvider,
  openai: openaiVideoProvider,
};

// Vision: real Gemini (mock-falls-back without GOOGLE_API_KEY). Analysis is a
// single step, not per-card switchable, so both ids map to the same provider.
const VISION_PROVIDERS: Record<ProviderId, VisionProvider> = {
  google: googleVisionProvider,
  openai: googleVisionProvider,
};

function resolveId(idOrCard: ProviderId | Card): ProviderId {
  return typeof idOrCard === "string" ? idOrCard : idOrCard.model.provider;
}

export function getImageProvider(idOrCard: ProviderId | Card): ImageProvider {
  return IMAGE_PROVIDERS[resolveId(idOrCard)];
}

export function getVideoProvider(
  idOrCard: ProviderId | Card,
): VideoProvider | undefined {
  return VIDEO_PROVIDERS[resolveId(idOrCard)];
}

// Vision defaults to google; returns a VisionProvider, never undefined.
export function getVisionProvider(id: ProviderId = "google"): VisionProvider {
  return VISION_PROVIDERS[id];
}

// Capability map for the UI to disable invalid ops per selected provider.
export function getCapabilities(idOrCard: ProviderId | Card): Capabilities {
  return getImageProvider(idOrCard).capabilities;
}

export const CAPABILITY_MAP: Record<ProviderId, Capabilities> = {
  google: googleImageProvider.capabilities,
  openai: openaiImageProvider.capabilities,
};

// Art director — one provider (Gemini text; mock-falls-back without a key).
export function getArtDirector(): ArtDirector {
  return googleArtDirector;
}

export { getStorageProvider } from "@/providers/storage";
export { assertCapability, canUse };
