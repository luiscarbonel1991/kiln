import { estimateGeneration, estimateVideo } from "@/domain/generation-cost";
import { snapSeconds, videoSecondsFor } from "@/domain/video";
import type { StudioCard } from "@/store/project";

export interface CardEstimate {
  typical: number;
  max: number;
}

// What one generation of a studio card costs on its own model: an image at its
// aspect and quality, a video at the length its model renders. null when the
// model has no pinned price.
export function cardEstimate(
  card: Pick<StudioCard, "type" | "model" | "references" | "video">,
): CardEstimate | null {
  if (card.type === "video") {
    const usd = estimateVideo(
      card.model,
      snapSeconds(
        card.video?.durationSec,
        videoSecondsFor(undefined, card.model),
      ),
    );
    return usd === null ? null : { typical: usd, max: usd };
  }
  return estimateGeneration(
    card.model,
    card.model.aspect,
    card.references.length,
  );
}

// Several cards at once: null when any has no pinned price.
export function sumEstimates(
  estimates: (CardEstimate | null)[],
): CardEstimate | null {
  if (estimates.some((e) => e === null)) return null;
  const sum = (pick: (e: CardEstimate) => number) =>
    Math.round(estimates.reduce((t, e) => t + (e ? pick(e) : 0), 0) * 100) /
    100;
  return { typical: sum((e) => e.typical), max: sum((e) => e.max) };
}

// "≈ $0.05–0.06", or one price when the range is a point (a video).
export function estimateHint(estimate: CardEstimate): string {
  return estimate.typical === estimate.max
    ? `$${estimate.max.toFixed(2)}`
    : `≈ $${estimate.typical.toFixed(2)}–${estimate.max.toFixed(2)}`;
}
