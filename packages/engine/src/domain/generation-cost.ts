// What a scene costs before anything is generated (ROADMAP principle 8, "cost
// before spend"). Prices are pinned with their date and source; an estimate is
// a range because Kiln sends gpt-image requests with quality "auto".
//
// Sources, checked 2026-10-02:
// - Google: per-image prices, https://ai.google.dev/gemini-api/docs/pricing
//   (official; one price per 1K image whatever the aspect).
// - OpenAI: the price list gives $ per 1M image output tokens
//   (https://developers.openai.com/api/docs/pricing: gpt-image-2 $30,
//   gpt-image-1.5 $32, gpt-image-1-mini $8). Per-image figures for gpt-image-2
//   at 1024x1024 (medium $0.053, high $0.211) are the image cost calculator's,
//   as reported by third parties; the other two are scaled by their token price
//   ("derived"). Portrait/landscape sizes (1024x1536) use 1.5x the tokens.
//   An edit also pays its input (the reference image and the prompt), which
//   the per-image figures leave out: `input` is a provisional allowance until
//   the queue has measured real usage.

export interface ImagePrice {
  provider: "google" | "openai";
  model: string;
  typical: number;
  max: number;
  input: { typical: number; max: number };
  nonSquareFactor: number;
  confidence: "official" | "derived";
}

export const PRICES_AS_OF = "2026-10-02";

const openai = (model: string, perMillionTokens: number): ImagePrice => ({
  provider: "openai",
  model,
  typical: round((0.053 * perMillionTokens) / 30),
  max: round((0.211 * perMillionTokens) / 30),
  input: { typical: 0.01, max: 0.02 },
  nonSquareFactor: 1.5,
  confidence: model === "gpt-image-2" ? "official" : "derived",
});

const google = (model: string, perImage: number): ImagePrice => ({
  provider: "google",
  model,
  typical: perImage,
  max: perImage,
  input: { typical: 0, max: 0.001 },
  nonSquareFactor: 1,
  confidence: "official",
});

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export const IMAGE_PRICES: ImagePrice[] = [
  openai("gpt-image-2", 30),
  openai("gpt-image-1.5", 32),
  openai("gpt-image-1-mini", 8),
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
  const factor = !aspect || aspect === "1:1" ? 1 : price.nonSquareFactor;
  return {
    typical: round(price.typical * factor + price.input.typical),
    max: round(price.max * factor + price.input.max),
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
    confidence: price.confidence,
  };
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
