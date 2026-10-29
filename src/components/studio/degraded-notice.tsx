"use client";

import { Loader2, Route, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { RanOn } from "@/domain/model-routing";
import type { Degraded } from "@/server/text-calls";

const money = (usd: number) => `$${usd.toFixed(2)}`;

// A text call that could not run (no key, a spend cap, an error): what the
// flow used instead, why, and the other provider to ask — only on a click,
// with its price. Never switched on its own.
export function DegradedNotice({
  degraded,
  fellBackTo,
  verb,
  pending,
  onAlternative,
  children,
}: {
  degraded: Degraded;
  // "a neutral description", "the recipe's own directions"
  fellBackTo: string;
  // "Read it", "Ask"
  verb: string;
  pending: boolean;
  onAlternative: (model: {
    provider: "google" | "openai";
    model: string;
  }) => void;
  children?: ReactNode;
}) {
  const alt = degraded.alternative;
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-card border border-dashed border-prov-local/50 bg-secondary/60 p-4">
      <p className="flex items-start gap-2 font-sans text-[0.8125rem] leading-snug text-foreground">
        <TriangleAlert className="mt-0.5 size-4 flex-shrink-0 text-prov-local" />
        <span>
          {degraded.label} could not answer: {degraded.message} Kiln used{" "}
          {fellBackTo}.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {alt ? (
          <button
            type="button"
            disabled={pending}
            data-testid={`degraded-${verb.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() =>
              onAlternative({ provider: alt.provider, model: alt.model })
            }
            className="inline-flex items-center gap-2 rounded-field bg-primary px-4 py-2 font-sans text-sm font-semibold text-primary-foreground shadow-button disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {verb} with {alt.label}
            {alt.usd === null ? "" : ` · ≈ ${money(alt.usd)}`}
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

// A text call that moved down its route (Settings → Models): which model
// answered, and why the first one did not. Nothing to act on; it says so
// because no model is ever switched unseen.
export function RanOnNotice({
  ranOn,
  testId,
}: {
  ranOn: RanOn;
  testId: string;
}) {
  return (
    <p
      data-testid={testId}
      className="mb-5 flex items-start gap-2 rounded-card border border-border-soft bg-secondary/60 px-4 py-3 font-sans text-[0.8rem] leading-snug text-on-surface-mid"
    >
      <Route className="mt-0.5 size-4 flex-shrink-0 text-prov-image" />
      <span>
        Answered by{" "}
        <span className="font-semibold text-foreground">{ranOn.label}</span>,
        next on the route: {ranOn.from} could not ({ranOn.reason}).
      </span>
    </p>
  );
}
