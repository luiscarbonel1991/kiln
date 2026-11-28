import { Circle, CircleAlert, CircleCheck, KeyRound } from "lucide-react";
import { keyLine, MOCK_CALLS_LINE } from "@/lib/provider-key-words";
import type { ProviderHealth } from "@/server/provider-health";

// When a call on a key last worked: the pine tick only once one has.
export function LastCall({ when }: { when: string | null }) {
  return (
    <div className="flex items-center gap-2 font-sans text-[0.8rem] text-on-surface-mid">
      {when ? (
        <CircleCheck className="size-3.5 flex-shrink-0 text-prov-recipe" />
      ) : (
        <Circle className="size-3.5 flex-shrink-0 text-on-surface-dim" />
      )}
      {when ? `Last call that worked: ${when}` : "No call that worked yet"}
    </div>
  );
}

// Settings → Providers, a provider's card for whoever reads no key list: a
// member, whose one line says whether they can generate and whom to ask,
// then the provider's last error and last call that worked; or the owner on
// a run with no database, who reads the last calls alone. The dates come in
// words, written on the server.
export function ProviderLines({
  health,
  ask,
  mock,
  errorLine,
  errorWhen,
  lastOkWhen,
}: {
  health: Pick<
    ProviderHealth,
    "provider" | "label" | "keyPresent" | "keyRejected" | "given"
  >;
  // Whom a member asks; null for the owner.
  ask: string | null;
  mock: boolean;
  // The last error in the reader's words; null when there is none to show.
  errorLine: string | null;
  errorWhen: string | null;
  lastOkWhen: string | null;
}) {
  const h = health;
  return (
    <>
      {/* The member's one line; the owner reads the key list. A mock run
          calls nothing: one line, the owner's too, and no call to speak of. */}
      {mock || ask !== null ? (
        <div
          className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-on-surface-mid"
          data-testid={`provider-${h.provider}-key`}
        >
          <KeyRound className="mt-0.5 size-3.5 flex-shrink-0" />
          {mock || ask === null
            ? MOCK_CALLS_LINE
            : keyLine({
                keyInReach: h.keyPresent,
                keyRejected: h.keyRejected,
                given: h.given,
                ask,
                label: h.label,
              })}
        </div>
      ) : null}
      {mock ? null : errorLine !== null ? (
        <div
          className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-foreground"
          data-testid={`provider-${h.provider}-error`}
        >
          <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {errorLine}{" "}
            <span className="font-mono text-[0.65rem] text-on-surface-dim">
              {errorWhen}
            </span>
          </span>
        </div>
      ) : null}
      {/* A member with no key in reach has made no call to speak of, and a
          card with an alarm says what is wrong, not when a call last worked. */}
      {!mock &&
      errorLine === null &&
      !(ask !== null && h.keyRejected) &&
      (lastOkWhen || ask === null || h.keyPresent) ? (
        <LastCall when={lastOkWhen} />
      ) : null}
    </>
  );
}
