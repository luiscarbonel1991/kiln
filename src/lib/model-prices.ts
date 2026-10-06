import {
  estimateGeneration,
  TEXT_CALL_BUDGETS,
  textEstimate,
  videoCost,
} from "@/domain/generation-cost";
import type {
  ImageQuality,
  ModelKind,
  VideoResolution,
} from "@/domain/model-defaults";

// Cents, or a tenth of a cent under $0.10 ("$0.051", "$0.05", "$0.40").
const money = (usd: number) =>
  usd < 0.1 ? `$${usd.toFixed(3).replace(/0$/, "")}` : `$${usd.toFixed(2)}`;

// A model's price as a picker shows it, beside its name: per image, per
// second of video, per photo read. Null when it has no pinned price (it then
// cannot run).
export function priceHint(
  model: {
    provider: string;
    model: string;
    quality?: ImageQuality;
    resolution?: VideoResolution;
  },
  kind: ModelKind,
): string | null {
  if (kind === "image") {
    const e = estimateGeneration(model, "4:5");
    return e ? `≈ ${money(e.typical)}/image` : null;
  }
  if (kind === "video") {
    const perSecond = videoCost(model, 1);
    return perSecond === null
      ? null
      : `${money(perSecond)}/s · 8 s ${money(perSecond * 8)}`;
  }
  const read = textEstimate(model, TEXT_CALL_BUDGETS.vision);
  return read === null ? null : `≤ ${money(read)}/photo read`;
}
