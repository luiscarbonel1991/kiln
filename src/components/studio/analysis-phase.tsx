"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { analyzeMaster } from "@/app/actions/analyze";
import { MasterPreview } from "@/components/studio/master-preview";
import { PaletteSwatches } from "@/components/studio/palette-swatches";
import { ProvenanceBadge } from "@/components/studio/provenance-badge";
import type { MasterAsset } from "@/domain/master-asset";
import type { BaseUnderstanding } from "@/domain/understanding";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace";

// Drives the attribute rows: each reads understanding[key]; palette is special-
// cased to swatches. Order matches the mockup ATTRS (subject … palette).
const ATTRS: { key: keyof BaseUnderstanding; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "materials", label: "Materials" },
  { key: "lighting", label: "Lighting" },
  { key: "composition", label: "Composition" },
  { key: "mood", label: "Mood" },
  { key: "palette", label: "Palette" },
];

export function AnalysisPhase({ master }: { master: MasterAsset }) {
  const understanding = useWorkspace((s) => s.understanding);
  const setUnderstanding = useWorkspace((s) => s.setUnderstanding);
  const goToPlanning = useWorkspace((s) => s.goToPlanning);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [error, setError] = useState(false);

  // Run the vision action once per master (guard on understanding null). The
  // server action is the only path into @/providers.
  useEffect(() => {
    if (understanding) return;
    let active = true;
    setError(false);
    analyzeMaster({ assetUrl: master.assetUrl })
      .then((result) => {
        if (active) setUnderstanding(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [master.assetUrl, understanding, setUnderstanding]);

  // Independent staggered reveal. Runs once per mount; the shell keys this
  // component on master.id, so a re-capture remounts and restarts the stagger.
  useEffect(() => {
    setAnalysisStep(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= ATTRS.length; i++) {
      timers.push(setTimeout(() => setAnalysisStep(i), i * 440));
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const scanning = analysisStep < ATTRS.length;
  const allRevealed = analysisStep >= ATTRS.length && understanding !== null;

  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-9 px-6 py-11 sm:grid-cols-[380px_1fr] sm:px-8">
      <MasterPreview master={master} scanning={scanning} />

      <div>
        <h2
          className="font-serif text-[1.625rem] font-semibold leading-tight text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          Reading the image
        </h2>
        <p className="mt-1 mb-5 font-sans text-[0.84375rem] leading-relaxed text-on-surface-mid">
          Everything extracted here becomes{" "}
          <span className="font-semibold text-prov-image">image-sourced</span>{" "}
          context and travels through the rest of the flow.
        </p>

        {error ? (
          <div className="mb-5 rounded-card border border-dashed border-border bg-secondary/60 p-5">
            <p className="font-sans text-sm text-on-surface-mid">
              Could not read the image.
            </p>
            <button
              type="button"
              onClick={() => setError(false)}
              className="mt-3 inline-flex items-center gap-2 rounded-field bg-primary px-4 py-2 font-sans text-sm font-semibold text-primary-foreground shadow-button"
            >
              Try again
            </button>
          </div>
        ) : (
          <div>
            {ATTRS.map((attr, i) => {
              if (analysisStep > i && understanding !== null) {
                const value = understanding[attr.key];
                return (
                  <div
                    key={attr.key}
                    className="flex items-start gap-3 border-b border-border-soft py-[11px] duration-300 animate-in fade-in slide-in-from-left-2"
                  >
                    <ProvenanceBadge
                      source="image"
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div>
                      <div className="mb-[3px] font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim">
                        {attr.label}
                      </div>
                      {attr.key === "palette" ? (
                        <PaletteSwatches colors={value as string[]} />
                      ) : (
                        <div className="font-sans text-sm text-foreground">
                          {value as string}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={attr.key}
                  className="flex items-center gap-3 border-b border-border-soft py-[11px] opacity-40"
                >
                  <div
                    className={cn(
                      "size-[7px] rounded-pill bg-on-surface-dim",
                      analysisStep === i && understanding === null
                        ? "animate-pulse"
                        : "",
                    )}
                  />
                  <span className="font-sans text-[0.8125rem] text-on-surface-dim">
                    {attr.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {allRevealed ? (
          <div className="mt-[22px] flex flex-col gap-2 duration-300 animate-in fade-in">
            <button
              type="button"
              onClick={goToPlanning}
              className="inline-flex w-fit items-center gap-2 rounded-field bg-primary px-5 py-[11px] font-sans text-sm font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/90"
            >
              Continue to planning <ArrowRight className="size-[15px]" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
