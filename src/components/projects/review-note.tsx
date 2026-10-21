"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Check, Suggestion } from "@/lib/product-review";

// What the review says about one field, under it: a suggestion to use or
// dismiss, a check to read and dismiss. Nothing changes until Use, and
// nothing is saved until Save.
export function ReviewNote({
  suggestion,
  check,
  onUse,
  onDismiss,
}: {
  suggestion?: Suggestion;
  check?: Check;
  onUse: (suggestion: Suggestion) => void;
  onDismiss: (kind: "suggestion" | "check") => void;
}) {
  if (!suggestion && !check) return null;
  return (
    <div data-review className="flex flex-col gap-1.5">
      {suggestion ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-field bg-secondary px-3 py-2">
          <Sparkles className="size-3 flex-shrink-0 text-primary" />
          <span className="font-sans text-[0.75rem] text-foreground">
            Suggested:{" "}
            <span className="font-semibold">
              {suggestion.value.length > 120
                ? `${suggestion.value.slice(0, 119)}…`
                : `“${suggestion.value}”`}
            </span>
          </span>
          <span className="font-sans text-[0.75rem] text-on-surface-mid">
            {suggestion.why}
          </span>
          <span className="ml-auto flex gap-1">
            <Button size="xs" onClick={() => onUse(suggestion)}>
              Use
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onDismiss("suggestion")}
            >
              Dismiss
            </Button>
          </span>
        </div>
      ) : null}
      {check ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-field bg-prov-brand/10 px-3 py-2">
          <span className="font-sans text-[0.75rem] text-prov-brand">
            Check: {check.why}
          </span>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={() => onDismiss("check")}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
