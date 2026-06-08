import { PHASE_INDEX, STEPS } from "@/components/studio/constants";
import { cn } from "@/lib/utils";
import type { Phase } from "@/store/workspace";

// Quiet, header-integrated phase indicator — four small dots + the current phase
// name in mono. Replaces the full-width top stepper (same pine/terracotta/line
// color semantics, far less chrome). Purely presentational.
export function PhaseIndicator({ phase }: { phase: Phase }) {
  const current = PHASE_INDEX[phase];
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5">
        {STEPS.map((step, i) => (
          <span
            key={step}
            className={cn(
              "size-1.5 rounded-pill transition-colors",
              i < current
                ? "bg-prov-recipe"
                : i === current
                  ? "bg-primary"
                  : "bg-border",
            )}
          />
        ))}
      </div>
      <span className="hidden font-mono text-[0.625rem] uppercase tracking-[0.14em] text-on-surface-mid sm:inline">
        {STEPS[current]}
      </span>
    </div>
  );
}
