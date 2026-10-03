"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { GenerationCard } from "@/components/studio/generation-card";
import { cn } from "@/lib/utils";
import { useProject } from "@/store/project";

// `projectMode`: the advanced view of a planned project's slots. The bulk
// re-roll is hidden there (it would start a paid generation on every slot), and
// the card opened from the board is scrolled to and outlined.
export function GenerationPhase({
  projectMode = false,
  focusCardId,
}: {
  projectMode?: boolean;
  focusCardId?: string;
}) {
  const cards = useProject((s) => s.cards);
  const master = useProject((s) => s.master);
  const understanding = useProject((s) => s.understanding);
  const regenerateUnlocked = useProject((s) => s.regenerateUnlocked);

  const ready = cards !== null && cards.length > 0;
  useEffect(() => {
    if (!ready || !focusCardId) return;
    document
      .getElementById(`card-${focusCardId}`)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [ready, focusCardId]);

  if (!cards || !master || !understanding) return null;

  return (
    <div>
      <div className="flex items-end justify-between gap-4 px-6 pt-5 sm:px-8">
        <div>
          <h2
            className="font-serif text-[1.625rem] font-semibold leading-tight text-foreground"
            style={{ fontVariationSettings: "'opsz' 144" }}
          >
            Variants
          </h2>
          <p className="mt-1 max-w-[480px] font-sans text-[0.84375rem] leading-relaxed text-on-surface-mid">
            {projectMode
              ? "One card per scene slot, all editing the product reference. Generate a card when you want it; each one is a paid call."
              : "Every card uses the master asset as context. Lock what works, regenerate the rest."}
          </p>
        </div>
        {projectMode ? null : (
          <button
            type="button"
            onClick={regenerateUnlocked}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-field bg-primary px-4 py-2.5 font-sans text-[0.84375rem] font-semibold text-primary-foreground shadow-button transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="size-3.5" /> Regenerate unlocked
          </button>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto px-6 py-5 sm:px-8">
        {cards.map((card) => (
          <div
            key={card.id}
            id={`card-${card.id}`}
            className={cn(
              "flex-shrink-0 rounded-card",
              card.id === focusCardId &&
                "ring-2 ring-primary ring-offset-4 ring-offset-background",
            )}
          >
            <GenerationCard
              card={card}
              master={master}
              understanding={understanding}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
