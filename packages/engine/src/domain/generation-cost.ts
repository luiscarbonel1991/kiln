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

export interface ImagePrice {
  provider: "google" | "openai";
  model: string;
  typical: number;
  max: number;
  nonSquareFactor: number;
  confidence: "official" | "derived";
}

export const PRICES_AS_OF = "2026-10-02";

const openai = (model: string, perMillionTokens: number): ImagePrice => ({
  provider: "openai",
  model,
  typical: round((0.053 * perMillionTokens) / 30),
  max: round((0.211 * perMillionTokens) / 30),
  nonSquareFactor: 1.5,
  confidence: model === "gpt-image-2" ? "official" : "derived",
});

const google = (model: string, perImage: number): ImagePrice => ({
  provider: "google",
  model,
  typical: perImage,
  max: perImage,
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

// One generation per scene slot, at each slot's aspect. null when the model has
// no pinned price (the UI says so instead of guessing).
export function estimateScenes(
  slots: { aspect?: string }[],
  model: { provider: string; model: string },
): SceneEstimate | null {
  const price = imagePrice(model);
  if (!price) return null;
  const factor = (aspect?: string) =>
    !aspect || aspect === "1:1" ? 1 : price.nonSquareFactor;
  const sum = (per: number) =>
    round(slots.reduce((t, s) => t + per * factor(s.aspect), 0));
  return {
    count: slots.length,
    typical: sum(price.typical),
    max: sum(price.max),
    confidence: price.confidence,
  };
}
