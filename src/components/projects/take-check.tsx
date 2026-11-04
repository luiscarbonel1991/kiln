"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { checkTakeAction } from "@/app/actions/board";
import { type TakeCheck, takeCheckLabel } from "@/domain/qc";
import { cn } from "@/lib/utils";

const CHIP = "font-mono text-[0.6rem] [overflow-wrap:anywhere]";

const TONE: Record<TakeCheck["status"], string> = {
  passed: "text-prov-recipe",
  failed: "text-prov-local",
  unchecked: "text-on-surface-dim",
};

export const SCALE_TITLE =
  "Kiln cannot measure a scene's scale: compare the product with what is around it before approving.";

// What Kiln read in a scene's shown take: its text and letterforms against the
// reference, and the size the scene asked for, which nothing measured. A take
// never checked (from before the check, or left unchecked) can be checked again
// for free. Approving is never blocked.
export function TakeCheckChips({
  projectId,
  destinationId,
  slotKey,
  cardId,
  check,
}: {
  projectId: string;
  destinationId: string;
  slotKey: string;
  cardId: string;
  check: TakeCheck | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const again = () =>
    startTransition(async () => {
      const result = await checkTakeAction({
        projectId,
        destinationId,
        slotKey,
      });
      setError(result?.error ?? null);
    });
  const detail = check
    ? [...check.problems, ...check.notes].join("\n") || undefined
    : undefined;
  return (
    <>
      <span
        data-testid={`slot-check-${cardId}`}
        data-status={check?.status ?? "none"}
        title={detail}
        className={cn(CHIP, check ? TONE[check.status] : "text-on-surface-dim")}
      >
        {check ? takeCheckLabel(check) : "not checked"}
      </span>
      {!check || check.status === "unchecked" ? (
        <button
          type="button"
          data-testid={`slot-check-again-${cardId}`}
          disabled={pending}
          onClick={again}
          className="inline-flex items-center gap-1 font-mono text-[0.6rem] text-primary underline-offset-2 hover:underline disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          Check · free
        </button>
      ) : null}
      {check?.scale ? (
        <span
          data-testid={`slot-scale-${cardId}`}
          title={SCALE_TITLE}
          className={cn(CHIP, "text-prov-brand")}
        >
          scale unverified · {check.scale}
        </span>
      ) : null}
      {error ? (
        <span className={cn(CHIP, "w-full text-prov-local")}>{error}</span>
      ) : null}
    </>
  );
}
