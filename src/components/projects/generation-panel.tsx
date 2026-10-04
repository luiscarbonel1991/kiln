"use client";

import { Loader2, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import {
  cancelBatchAction,
  enqueueGenerationAction,
} from "@/app/actions/generation";
import { Button } from "@/components/ui/button";
import { canAfford, fromMicros } from "@/domain/generation-cost";
import type { BatchProgress, Budget } from "@/server/generation-repository";

const money = (micros: number) => `$${fromMicros(micros).toFixed(2)}`;

export interface BatchEstimate {
  count: number;
  typicalMicros: number;
  maxMicros: number;
  model: string;
  quality: string | null;
}

// The board's generate panel (ROADMAP principle 8, "cost before spend, one
// approval per batch"): one button for every waiting scene, a confirmation
// that states the count, model, estimated range and the month's budget, then
// the running batch's progress with Cancel. Generation runs in the background.
export function GenerationPanel({
  projectId,
  cardIds,
  estimate,
  batch,
  budget,
  mode,
}: {
  projectId: string;
  cardIds: string[];
  estimate: BatchEstimate | null;
  batch: BatchProgress | null;
  budget: Budget;
  mode: "live" | "mock";
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fits =
    mode === "mock" ||
    (estimate !== null &&
      canAfford({
        spentMicros: budget.spentMicros,
        reservedMicros: budget.reservedMicros,
        requestMicros: estimate.maxMicros,
        capMicros: budget.capMicros,
      }));

  function generate() {
    if (!estimate) return;
    setError(null);
    startTransition(async () => {
      const result = await enqueueGenerationAction({
        projectId,
        cardIds,
        shownMaxMicros: estimate.maxMicros,
      });
      if ("error" in result) setError(result.error);
      else setConfirming(false);
    });
  }

  const total = batch
    ? batch.queued + batch.running + batch.done + batch.failed + batch.canceled
    : 0;

  return (
    <div className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
      <h2 className="font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
        Generate
      </h2>

      {batch ? (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-sm text-foreground">
            Generating in the background · {batch.done} of {total} done
            {batch.failed > 0 ? ` · ${batch.failed} failed` : ""}
          </p>
          <div className="h-1.5 overflow-hidden rounded-pill bg-surface-soft">
            <div
              className="h-full rounded-pill bg-primary transition-[width]"
              style={{
                width: `${total ? ((batch.done + batch.failed) / total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="font-mono text-[0.65rem] text-on-surface-mid">
            {batch.running} running · {batch.queued} queued · you can leave this
            page
          </p>
          {batch.queued > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="self-start"
              disabled={pending}
              onClick={() =>
                startTransition(() =>
                  cancelBatchAction({ batchId: batch.batchId }),
                )
              }
            >
              <X /> Cancel the {batch.queued} queued
            </Button>
          ) : null}
        </div>
      ) : null}

      {estimate && estimate.count > 0 ? (
        <Button
          onClick={() => setConfirming(true)}
          className="h-9 self-start rounded-field font-semibold shadow-button"
        >
          <Sparkles /> Generate {estimate.count} scene
          {estimate.count === 1 ? "" : "s"} · ≈ {money(estimate.typicalMicros)}–
          {money(estimate.maxMicros)}
        </Button>
      ) : batch ? null : (
        <p className="font-sans text-[0.75rem] text-on-surface-mid">
          No scene is waiting.
        </p>
      )}

      <p className="font-mono text-[0.65rem] leading-snug text-on-surface-mid">
        {mode === "mock"
          ? "Mock mode: nothing is paid or counted."
          : `This month: ${money(budget.spentMicros)} spent${budget.reservedMicros > 0 ? ` + ${money(budget.reservedMicros)} queued` : ""} of ${money(budget.capMicros)} (counted since 2026-10-04).`}
      </p>

      {confirming && estimate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-foreground/60 backdrop-blur-sm"
            onClick={() => !pending && setConfirming(false)}
          />
          <div className="relative flex w-full max-w-md flex-col gap-4 rounded-card bg-card p-6 shadow-card">
            <h3
              className="font-serif text-xl italic text-foreground"
              style={{ fontVariationSettings: "'opsz' 40" }}
            >
              Generate {estimate.count} scene{estimate.count === 1 ? "" : "s"}?
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-sans text-sm">
              <dt className="text-on-surface-mid">Model</dt>
              <dd className="font-mono text-[0.8rem] text-foreground">
                {estimate.model}
                {estimate.quality ? `, quality ${estimate.quality}` : ""}
              </dd>
              <dt className="text-on-surface-mid">Estimated</dt>
              <dd className="text-foreground">
                {money(estimate.typicalMicros)} typical, at most{" "}
                {money(estimate.maxMicros)}
              </dd>
              <dt className="text-on-surface-mid">This month</dt>
              <dd className="text-foreground">
                {mode === "mock"
                  ? "mock mode, not counted"
                  : `${money(budget.spentMicros + budget.reservedMicros)} of ${money(budget.capMicros)} used`}
              </dd>
            </dl>
            <p className="font-sans text-[0.8rem] leading-snug text-on-surface-mid">
              Kiln runs them in the background, one retry each if a call fails;
              you can leave this page. The cost is measured from what OpenAI
              reports.
            </p>
            {!fits ? (
              <p className="font-mono text-[0.7rem] text-prov-local">
                This batch would go over the monthly cap.
              </p>
            ) : null}
            {error ? (
              <p className="font-mono text-[0.7rem] text-prov-local">{error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Not now
              </Button>
              <Button
                disabled={pending || !fits}
                onClick={generate}
                className="font-semibold shadow-button"
              >
                {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Generate {estimate.count}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
