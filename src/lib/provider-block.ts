import type { ProviderNote } from "@/components/models/model-choice";
import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";

// Why a provider cannot take a paid call now, before anyone clicks (DOGFOOD
// #44): in a live run, no key, or a key it rejected on its last call. Null
// when it may (a transient failure is only noted: the next call may work).
// Mock runs call no provider, so nothing blocks them.
export function providerBlock(
  notes: ProviderNote[],
  provider: ProviderId,
  mode: "live" | "mock",
): string | null {
  if (mode === "mock") return null;
  const note = notes.find((n) => n.provider === provider);
  if (!note) return null;
  const label = PROVIDER_LABELS[provider];
  const other = provider === "google" ? "an OpenAI" : "a Google";
  if (!note.keyPresent) {
    return `${label} has no API key: add one in Settings → Providers, or pick ${other} model.`;
  }
  if (note.keyRejected) {
    return `${label} rejected the API key on its last call: replace it in Settings → Providers, or pick ${other} model.`;
  }
  return null;
}
