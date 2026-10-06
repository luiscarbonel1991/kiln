import {
  type ImageQuality,
  OPENAI_IMAGE_QUALITY,
} from "@/domain/model-defaults";

// What a scene costs before anything is generated (ROADMAP principle 8, "cost
// before spend"). Prices are pinned with their date and source.
//
// Sources, checked 2026-10-04:
// - Google: per-image prices, https://ai.google.dev/gemini-api/docs/pricing
//   (official; one price per 1K image whatever the aspect).
// - OpenAI: the output cost per image by quality and size from the image
//   generation guide's cost table (https://developers.openai.com/api/docs/
//   guides/image-generation, "Calculating costs"). Kiln pins the request
//   quality (OPENAI_IMAGE_QUALITY), so the estimate reads that row. Measured
//   2026-10-04 on gpt-image-2 medium (6 live edits): exactly 1756 output tokens
//   square and 1372 portrait every time ($0.0527 / $0.0412, the table's
//   figures), so the output needs no margin once the quality is pinned ("auto"
//   varied per image). An edit also pays its input (the reference image, at
//   high fidelity on gpt-image-2, and the prompt): measured at 203-206 text +
//   1024 image tokens (~$0.0092) with a 1024px reference; the input max leaves
//   room for longer prompts and larger references.

export interface ImagePrice {
  provider: "google" | "openai";
  model: string;
  // The quality the request is sent with; null where the API has none.
  quality: ImageQuality | null;
  // $ per image: square (1024x1024) and non-square (1024x1536 / 1536x1024).
  output: { square: number; nonSquare: number };
  input: { typical: number; max: number };
  confidence: "official" | "derived";
}

export const PRICES_AS_OF = "2026-10-04";

// $ per image output: [square, non-square] for each quality.
const OPENAI_OUTPUT: Record<string, Record<ImageQuality, [number, number]>> = {
  "gpt-image-2": {
    low: [0.006, 0.005],
    medium: [0.053, 0.041],
    high: [0.211, 0.165],
  },
  "gpt-image-1.5": {
    low: [0.009, 0.013],
    medium: [0.034, 0.05],
    high: [0.133, 0.2],
  },
  "gpt-image-1-mini": {
    low: [0.005, 0.006],
    medium: [0.011, 0.015],
    high: [0.036, 0.052],
  },
};

const openai = (model: string): ImagePrice => {
  const [square, nonSquare] = OPENAI_OUTPUT[model][OPENAI_IMAGE_QUALITY];
  return {
    provider: "openai",
    model,
    quality: OPENAI_IMAGE_QUALITY,
    output: { square, nonSquare },
    input: { typical: 0.01, max: 0.02 },
    confidence: "official",
  };
};

const google = (model: string, perImage: number): ImagePrice => ({
  provider: "google",
  model,
  quality: null,
  output: { square: perImage, nonSquare: perImage },
  input: { typical: 0, max: 0.001 },
  confidence: "official",
});

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export const IMAGE_PRICES: ImagePrice[] = [
  openai("gpt-image-2"),
  openai("gpt-image-1.5"),
  openai("gpt-image-1-mini"),
  google("gemini-3.1-flash-image", 0.067),
  google("gemini-3.1-flash-lite-image", 0.0336),
  google("gemini-3-pro-image", 0.134),
];

export function imagePrice(model: {
  provider: string;
  model: string;
}): ImagePrice | undefined {
  return IMAGE_PRICES.find(
    (p) => p.provider === model.provider && p.model === model.model,
  );
}

export interface SceneEstimate {
  count: number;
  typical: number;
  max: number;
  quality: ImagePrice["quality"];
  confidence: ImagePrice["confidence"];
}

// What one generation at this model and aspect costs: output plus the edit's
// input allowance. null when the model has no pinned price.
export function estimateGeneration(
  model: { provider: string; model: string },
  aspect?: string,
): { typical: number; max: number } | null {
  const price = imagePrice(model);
  if (!price) return null;
  const output =
    !aspect || aspect === "1:1" ? price.output.square : price.output.nonSquare;
  return {
    typical: round(output + price.input.typical),
    max: round(output + price.input.max),
  };
}

// One generation per scene slot, at each slot's aspect. null when the model has
// no pinned price (the UI says so instead of guessing).
export function estimateScenes(
  slots: { aspect?: string }[],
  model: { provider: string; model: string },
): SceneEstimate | null {
  const price = imagePrice(model);
  if (!price) return null;
  const each = slots.map((s) => estimateGeneration(model, s.aspect));
  const sum = (pick: (e: { typical: number; max: number }) => number) =>
    round(each.reduce((t, e) => t + (e ? pick(e) : 0), 0));
  return {
    count: slots.length,
    typical: sum((e) => e.typical),
    max: sum((e) => e.max),
    quality: price.quality,
    confidence: price.confidence,
  };
}

// Video: OpenAI bills Sora by the second generated, at a price per size
// (https://developers.openai.com/api/docs/models/sora-2 and .../sora-2-pro,
// checked 2026-10-05). Kiln renders only 720x1280 / 1280x720, the size both
// models share, so one price per second per model.
export const VIDEO_PRICES_AS_OF = "2026-10-05";

const VIDEO_PER_SECOND: Record<string, number> = {
  "sora-2": 0.1,
  "sora-2-pro": 0.3,
};

// Sora takes 4, 8 or 12 seconds; a card's duration snaps to the nearest. The
// adapter sends this and the estimate prices it, so they always agree.
export function soraSeconds(durationSec: number): 4 | 8 | 12 {
  if (durationSec <= 6) return 4;
  if (durationSec <= 10) return 8;
  return 12;
}

// What `seconds` of video cost on this model; null when it has no pinned price.
export function videoCost(model: string, seconds: number): number | null {
  const perSecond = VIDEO_PER_SECOND[model];
  return perSecond === undefined ? null : round(perSecond * seconds);
}

// What one video at this duration costs. Billing is by the seconds generated,
// so the estimate is also the measured cost of a finished video.
export function estimateVideo(
  model: { provider: string; model: string },
  durationSec: number,
): number | null {
  if (model.provider !== "openai") return null;
  return videoCost(model.model, soraSeconds(durationSec));
}

// Official token prices, $ per 1M tokens (https://developers.openai.com/api/
// docs/pricing, 2026-10-02): what a finished generation actually cost, from the
// usage the API returns.
const TOKEN_PRICES: Record<
  string,
  { textIn: number; imageIn: number; imageOut: number }
> = {
  "gpt-image-2": { textIn: 5, imageIn: 8, imageOut: 30 },
  "gpt-image-1.5": { textIn: 5, imageIn: 8, imageOut: 32 },
  "gpt-image-1-mini": { textIn: 2, imageIn: 2.5, imageOut: 8 },
};

export interface GenerationUsage {
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
}

export function costFromUsage(
  model: string,
  usage: GenerationUsage,
): number | null {
  const p = TOKEN_PRICES[model];
  if (!p) return null;
  return (
    (usage.inputTextTokens * p.textIn +
      usage.inputImageTokens * p.imageIn +
      usage.outputTokens * p.imageOut) /
    1_000_000
  );
}

// Money in whole micro-dollars (no float drift in sums and comparisons).
export const toMicros = (usd: number): number => Math.round(usd * 1_000_000);
export const fromMicros = (micros: number): number => micros / 1_000_000;

// The monthly cap check: what was spent this month, what is already queued or
// running (reserved at its estimated max), and the new request must fit.
export function canAfford(input: {
  spentMicros: number;
  reservedMicros: number;
  requestMicros: number;
  capMicros: number;
}): boolean {
  return (
    input.spentMicros + input.reservedMicros + input.requestMicros <=
    input.capMicros
  );
}
