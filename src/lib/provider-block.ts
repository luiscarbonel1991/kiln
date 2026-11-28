import type { ProviderNote } from "@/components/models/model-choice";
import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import {
  blockNoKeyLine,
  blockOwnerNoKeyLine,
  blockRejectedLine,
  orPickLine,
} from "@/lib/provider-key-words";

// Why a provider cannot take a paid call now, before anyone clicks (DOGFOOD
// #44): in a live run, no key, or a key it rejected on its last call. Null
// when it may (a transient failure is only noted: the next call may work).
// Mock runs call no provider, so nothing blocks them. `ask` is whom a member
// asks: they read no way to Settings; null is the owner, a token or a script.
// The other provider is offered only when it can run: a key, not rejected.
// The owner's line says why they have no key (the note's `reach`, which a
// member's notes never carry); a member's says whom to ask, and names the key
// the owner gave them when that is the one rejected.
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
    return blockOwnerNoKeyLine(label, other, note.reach);
  }
  if (note.keyRejected) {
    if (ask !== null) return blockRejectedLine(label, other, ask, note.given);
    return `${label} rejected the API key on its last call: replace it in Settings → Providers${orPickLine(other)}`;
  }
  return null;
}
