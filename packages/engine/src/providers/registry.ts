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
import { openaiArtDirector } from "@/providers/openai/art-director";
import { openaiImageProvider } from "@/providers/openai/image";
import { openaiVisionProvider } from "@/providers/openai/vision";
import type { Capabilities } from "@/providers/types";

const IMAGE_PROVIDERS: Record<ProviderId, ImageProvider> = {
  google: googleImageProvider,
  openai: openaiImageProvider,
};

// Video: Veo only. OpenAI shut Sora down on 2026-09-24 and has no other video
// model; Sora outputs keep their label (the catalog), never a call.
const VIDEO_PROVIDERS: Partial<Record<ProviderId, VideoProvider>> = {
  google: googleVideoProvider,
};

// Vision and art direction: the maker's text model, on either provider.
const VISION_PROVIDERS: Record<ProviderId, VisionProvider> = {
  google: googleVisionProvider,
  openai: openaiVisionProvider,
};

const ART_DIRECTORS: Record<ProviderId, ArtDirector> = {
  google: googleArtDirector,
  openai: openaiArtDirector,
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

export function getVisionProvider(id: ProviderId): VisionProvider {
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

export function getArtDirector(id: ProviderId): ArtDirector {
  return ART_DIRECTORS[id];
}

export { getStorageProvider } from "@/providers/storage";
export { assertCapability, canUse };
