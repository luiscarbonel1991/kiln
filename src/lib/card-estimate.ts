import {
  NO_TAKE_ROUTES,
  type TakeRoutes,
  takeEstimate,
  videoTakeEstimate,
} from "@/domain/model-routing";
import { snapSeconds, videoSecondsFor } from "@/domain/video";
import type { StudioCard } from "@/store/project";

export interface CardEstimate {
  typical: number;
  max: number;
}

// What one generation of a studio card costs: an image at its aspect and
// quality, a video at the length its model renders; its max the dearest model
// of its route it may run on (a planned project's card goes through the
// queue, which reserves the same). null when its model has no pinned price.
export function cardEstimate(
  card: Pick<StudioCard, "type" | "model" | "references" | "video">,
  routes: TakeRoutes = NO_TAKE_ROUTES,
): CardEstimate | null {
  if (card.type === "video") {
    const usd = videoTakeEstimate(
      card.model,
      snapSeconds(
        card.video?.durationSec,
        videoSecondsFor(undefined, card.model),
      ),
      routes.video,
    );
    return usd === null ? null : { typical: usd, max: usd };
  }
  return takeEstimate(card.model, card.references.length, routes.final);
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
