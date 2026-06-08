import { type ImageOp, PROVIDER_CAPABILITIES } from "@/domain/capabilities";
import { CapabilityError } from "@/providers/errors";
import type { ImageProvider } from "@/providers/interfaces";

// Single source of truth lives in @/domain/capabilities; re-exposed here for the
// adapters/registry that consume the providers layer.
export const GOOGLE_CAPS = PROVIDER_CAPABILITIES.google;
export const OPENAI_CAPS = PROVIDER_CAPABILITIES.openai;

type ProviderCaps = Pick<ImageProvider, "id" | "capabilities">;

// Non-throwing predicate for the UI (disable invalid ops / over-limit refs).
export function canUse(provider: ProviderCaps, op: ImageOp, refs = 0): boolean {
  if (!provider.capabilities[op]) return false;
  if (refs > provider.capabilities.maxRefs) return false;
  return true;
}

// Throwing guard for adapters / actions.
export function assertCapability(
  provider: ProviderCaps,
  op: ImageOp,
  refs = 0,
): void {
  if (!provider.capabilities[op]) {
    throw new CapabilityError(provider.id, op, "unsupported");
  }
  if (refs > provider.capabilities.maxRefs) {
    throw new CapabilityError(
      provider.id,
      op,
      "max-refs-exceeded",
      `Provider "${provider.id}" allows at most ${provider.capabilities.maxRefs} reference image(s), got ${refs}.`,
    );
  }
}
