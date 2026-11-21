import type { ProviderNote } from "@/components/models/model-choice";
import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import {
  blockNoKeyLine,
  blockRejectedLine,
  orPickLine,
} from "@/lib/provider-key-words";

// Why a provider cannot take a paid call now, before anyone clicks (DOGFOOD
// #44): in a live run, no key, or a key it rejected on its last call. Null
// when it may (a transient failure is only noted: the next call may work).
// Mock runs call no provider, so nothing blocks them. `ask` is whom a member
// asks: they read no way to Settings; null is the owner, a token or a script.
// The other provider is offered only when it can run: a key, not rejected.
export function providerBlock(
  notes: ProviderNote[],
  provider: ProviderId,
  mode: "live" | "mock",
  ask: string | null = null,
): string | null {
  if (mode === "mock") return null;
  const note = notes.find((n) => n.provider === provider);
  if (!note) return null;
  const label = PROVIDER_LABELS[provider];
  const otherNote = notes.find(
    (n) => n.provider === (provider === "google" ? "openai" : "google"),
  );
  const other =
    otherNote?.keyPresent && !otherNote.keyRejected
      ? PROVIDER_LABELS[otherNote.provider]
      : null;
  if (!note.keyPresent) {
    if (ask !== null) return blockNoKeyLine(label, other, ask);
    return `${label} has no API key: add one in Settings → Providers${orPickLine(other)}`;
  }
  if (note.keyRejected) {
    if (ask !== null) return blockRejectedLine(label, other, ask);
    return `${label} rejected the API key on its last call: replace it in Settings → Providers${orPickLine(other)}`;
  }
  return null;
}
