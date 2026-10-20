"use client";

import { SlidersHorizontal } from "lucide-react";
import { Popover, ToggleGroup } from "radix-ui";
import { useState, useTransition } from "react";
import { setSlotKnobAction } from "@/app/actions/board";
import type { KnobChoice } from "@/domain/scene-knobs";
import type { TuneView } from "@/lib/slot-tune";
import { cn } from "@/lib/utils";

const LABEL =
  "font-sans text-[0.625rem] font-bold uppercase tracking-[0.16em] text-on-surface-mid";
const NOTE = "font-sans text-[0.7rem] leading-snug";
const DIRECTION_LABEL = {
  scene: "Scene",
  composition: "Composition",
  lighting: "Lighting",
} as const;

// A scene's knobs on the board (ROADMAP "Knobs, not prose"): a line says how
// the scene is set, Tune opens its stops. Turning one is free and writes the
// scene's direction again at once; only a new take costs.
export function SlotTune({
  projectId,
  destinationId,
  slotKey,
  tune,
}: {
  projectId: string;
  destinationId: string;
  slotKey: string;
  tune: TuneView;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (choice: KnobChoice) =>
    startTransition(async () => {
      const result = await setSlotKnobAction({
        projectId,
        destinationId,
        slotKey,
        choice,
      });
      setError(result?.error ?? null);
    });
  const disabled = pending || tune.locked !== null;
  return (
    <div className="flex w-full min-w-0 basis-full items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[0.625rem] text-on-surface-mid">
        {tune.summary || "Any camera, distance and light"}
      </span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 font-sans text-[0.72rem] font-semibold text-primary hover:underline"
          >
            <SlidersHorizontal className="size-3" /> Tune
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[23rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-card bg-card p-4 shadow-card ring-1 ring-border"
          >
            {tune.locked ? (
              <p className={cn(NOTE, "text-prov-brand")}>{tune.locked}</p>
            ) : (
              <p className={cn(NOTE, "text-on-surface-mid")}>
                Free to change. The next take reads it.
              </p>
            )}
            {tune.knobs.map((knob) => {
              const current = knob.stops.find((s) => s.key === knob.stop);
              return (
                <div key={knob.key} className="flex flex-col gap-1.5">
                  <span className={LABEL}>{knob.label}</span>
                  <ToggleGroup.Root
                    type="single"
                    value={knob.stop}
                    onValueChange={(stop) => {
                      if (stop && stop !== knob.stop) {
                        set({ knob: knob.key, stop } as KnobChoice);
                      }
                    }}
                    disabled={disabled}
                    aria-label={knob.label}
                    className="flex flex-wrap gap-1.5"
                  >
                    {knob.stops.map((stop) => (
                      <ToggleGroup.Item
                        key={stop.key}
                        value={stop.key}
                        className={cn(
                          "rounded-field px-2.5 py-1 font-sans text-[0.75rem] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          knob.stop === stop.key
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-foreground hover:bg-surface-soft",
                        )}
                      >
                        {stop.label}
                      </ToggleGroup.Item>
                    ))}
                  </ToggleGroup.Root>
                  <span className={cn(NOTE, "text-on-surface-mid")}>
                    {current?.hint}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[0.6rem] text-on-surface-dim">
                    {knob.chosen ? (
                      <>
                        your choice
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            set({ knob: knob.key, stop: null } as KnobChoice)
                          }
                          className="font-sans text-[0.68rem] font-semibold text-primary hover:underline disabled:opacity-60"
                        >
                          Reset
                        </button>
                      </>
                    ) : knob.why ? (
                      <span className="text-prov-brand">
                        Kiln's pick: {knob.why}
                      </span>
                    ) : (
                      "the scene's default"
                    )}
                  </span>
                </div>
              );
            })}
            {tune.inert.prompt ? (
              <p className={cn(NOTE, "text-prov-local")}>
                This scene runs its own prompt from the editor; the knobs reach
                it once that prompt is cleared.
              </p>
            ) : null}
            {tune.inert.fields.length > 0 ? (
              <p className={cn(NOTE, "text-prov-local")}>
                Written in the editor:{" "}
                {tune.inert.fields
                  .map((f) => DIRECTION_LABEL[f].toLowerCase())
                  .join(", ")}
                . The knobs leave it as written.
              </p>
            ) : null}
            {tune.reads ? (
              <details className="group">
                <summary className="cursor-pointer font-sans text-[0.72rem] font-semibold text-on-surface-mid">
                  What the model reads
                </summary>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {(["scene", "composition", "lighting"] as const).map((f) => (
                    <div key={f}>
                      <dt className={LABEL}>{DIRECTION_LABEL[f]}</dt>
                      <dd className="font-mono text-[0.625rem] leading-relaxed text-foreground">
                        {tune.reads?.[f]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
            {error ? (
              <p className="font-mono text-[0.6rem] text-prov-local">{error}</p>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
