import {
  DEFAULT_EFFORT,
  type Effort,
  effortOn,
  effortScale,
} from "@/domain/effort";
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_VIDEO_RESOLUTION,
  type ImageQuality,
  modelEntry,
  type VideoResolution,
} from "@/domain/model-defaults";

// What a generation costs before anything is generated (ROADMAP principle 8,
// "cost before spend"). Prices are pinned with their date and source; a model
// without one cannot be queued or run under the cap.
//
// Sources:
// - Google, checked 2026-10-06: https://ai.google.dev/gemini-api/docs/pricing
//   (official). Images: one price per 1K image whatever the aspect (1,120
//   output tokens); text and thinking beside the image at the text rate. Veo:
//   per second by resolution, audio included. Text: per 1M tokens, thinking
//   billed as output; text checked again 2026-10-31, with the prices Google
//   has dated (Gemini 4 Argon from 2026-12-01, the Flash models from
//   2027-01-01).
// - OpenAI, checked 2026-10-04 (images) and 2026-10-31 (text): the output cost
//   per image by quality and size from the image generation guide's cost table
//   (https://developers.openai.com/api/docs/guides/image-generation,
//   "Calculating costs"), and https://developers.openai.com/api/docs/pricing
//   for token prices. Kiln pins the request quality, so the estimate reads that
//   row. Measured 2026-10-04 on gpt-image-2 medium (6 live edits): exactly 1756
//   output tokens square and 1372 portrait every time ($0.0527 / $0.0412, the
//   table's figures), so the output needs no margin once the quality is pinned
//   ("auto" varied per image). An edit also pays its input (the reference
//   image, at high fidelity on gpt-image-2, and the prompt): measured at
//   203-206 text + 1024 image tokens (~$0.0092) with a 1024px reference; the
//   input max leaves room for longer prompts and larger references.

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

export const PRICES_AS_OF = "2026-10-06";

// $ per 1M tokens. An image model's main output is the image (`imageOut`);
// text and thinking beside it bill at `textOut`. A text model's output,
// thinking included, bills at `textOut`.
interface Prices {
  textIn: number;
  imageIn: number;
  textOut: number;
  imageOut: number;
}
// A price the provider has dated: `then` applies from its day (UTC) on.
interface TokenPrices extends Prices {
  then?: Prices & { from: string };
}

const TOKEN_PRICES: Record<string, TokenPrices> = {
  "openai/gpt-image-2": { textIn: 5, imageIn: 8, textOut: 0, imageOut: 30 },
  "openai/gpt-image-1.5": { textIn: 5, imageIn: 8, textOut: 0, imageOut: 32 },
  "openai/gpt-image-1-mini": {
    textIn: 2,
    imageIn: 2.5,
    textOut: 0,
    imageOut: 8,
  },
  "google/gemini-3.1-flash-image": {
    textIn: 0.5,
    imageIn: 0.5,
    textOut: 3,
    imageOut: 60,
  },
  "google/gemini-3.1-flash-lite-image": {
    textIn: 0.25,
    imageIn: 0.25,
    textOut: 1.5,
    imageOut: 30,
  },
  "google/gemini-3-pro-image": {
    textIn: 2,
    imageIn: 2,
    textOut: 12,
    imageOut: 120,
  },
  "openai/gpt-6.1-sol": { textIn: 2, imageIn: 2, textOut: 10, imageOut: 0 },
  "openai/gpt-6-astra": { textIn: 10, imageIn: 10, textOut: 50, imageOut: 0 },
  "openai/gpt-6.1-terra": { textIn: 1, imageIn: 1, textOut: 5, imageOut: 0 },
  "openai/gpt-6-luna": { textIn: 0.1, imageIn: 0.1, textOut: 0.5, imageOut: 0 },
  "google/gemini-3.5-flash": {
    textIn: 1.5,
    imageIn: 1.5,
    textOut: 9,
    imageOut: 0,
  },
  "google/gemini-3.8-flash": {
    textIn: 0.75,
    imageIn: 0.75,
    textOut: 3.75,
    imageOut: 0,
    then: {
      from: "2027-01-01",
      textIn: 1.5,
      imageIn: 1.5,
      textOut: 7.5,
      imageOut: 0,
    },
  },
  "google/gemini-4-argon": {
    textIn: 2,
    imageIn: 2,
    textOut: 10,
    imageOut: 0,
    then: {
      from: "2026-12-01",
      textIn: 4,
      imageIn: 4,
      textOut: 20,
      imageOut: 0,
    },
  },
  "google/gemini-3.6-flash": {
    textIn: 0.75,
    imageIn: 0.75,
    textOut: 3.75,
    imageOut: 0,
    then: {
      from: "2027-01-01",
      textIn: 1.5,
      imageIn: 1.5,
      textOut: 7.5,
      imageOut: 0,
    },
  },
  "google/gemini-3.5-flash-lite": {
    textIn: 0.3,
    imageIn: 0.3,
    textOut: 2.5,
    imageOut: 0,
  },
};

const key = (model: { provider: string; model: string }) =>
  `${model.provider}/${model.model}`;

// A model's token prices today (or on `at`).
function tokenPrices(
  model: { provider: string; model: string },
  at: Date = new Date(),
): Prices | undefined {
  const p = TOKEN_PRICES[key(model)];
  if (p?.then && at.toISOString().slice(0, 10) >= p.then.from) return p.then;
  return p;
}

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

// $ per 1K image (1,120 output tokens at the image rate).
const GOOGLE_PER_IMAGE: Record<string, number> = {
  "gemini-3.1-flash-image": 0.067,
  "gemini-3.1-flash-lite-image": 0.0336,
  "gemini-3-pro-image": 0.134,
};

// What a Gemini edit reads: the prompt and the reference (about 1,100 tokens
// per image), up to three more references at most.
const GOOGLE_INPUT_TOKENS = { typical: 1_800, max: 5_000 };

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function imagePrice(model: {
  provider: string;
  model: string;
  quality?: ImageQuality;
}): ImagePrice | undefined {
  if (model.provider === "openai") {
    const rows = OPENAI_OUTPUT[model.model];
    if (!rows) return undefined;
    const quality = model.quality ?? DEFAULT_IMAGE_QUALITY;
    const [square, nonSquare] = rows[quality];
    return {
      provider: "openai",
      model: model.model,
      quality,
      output: { square, nonSquare },
      input: { typical: 0.01, max: 0.02 },
      confidence: "official",
    };
  }
  if (model.provider === "google") {
    const perImage = GOOGLE_PER_IMAGE[model.model];
    const tokens = tokenPrices(model);
    if (perImage === undefined || !tokens) return undefined;
    return {
      provider: "google",
      model: model.model,
      quality: null,
      output: { square: perImage, nonSquare: perImage },
      input: {
        typical: round((GOOGLE_INPUT_TOKENS.typical * tokens.imageIn) / 1e6),
        max: round((GOOGLE_INPUT_TOKENS.max * tokens.imageIn) / 1e6),
      },
      confidence: "official",
    };
  }
  return undefined;
}

export interface SceneEstimate {
  count: number;
  typical: number;
  max: number;
  quality: ImagePrice["quality"];
  confidence: ImagePrice["confidence"];
}

// Each further reference an edit reads (a material sample beside the
// product's reference) is about one more 1024 px image of input: ~1,024
// image tokens on gpt-image-2 (~$0.008, measured on the reference), ~1,100
// tokens on Gemini. Gemini's input max already allows three more.
const OPENAI_PER_REFERENCE = { typical: 0.009, max: 0.012 };
const GOOGLE_TOKENS_PER_REFERENCE = 1_100;

// What one generation at this model and aspect costs: output plus the edit's
// input allowance, with `references` further images read beside the
// reference. null when the model has no pinned price.
export function estimateGeneration(
  model: { provider: string; model: string; quality?: ImageQuality },
  aspect?: string,
  references = 0,
): { typical: number; max: number } | null {
  const price = imagePrice(model);
  if (!price) return null;
  const output =
    !aspect || aspect === "1:1" ? price.output.square : price.output.nonSquare;
  const extra =
    references === 0
      ? { typical: 0, max: 0 }
      : price.provider === "openai"
        ? {
            typical: OPENAI_PER_REFERENCE.typical * references,
            max: OPENAI_PER_REFERENCE.max * references,
          }
        : {
            typical:
              (GOOGLE_TOKENS_PER_REFERENCE *
                references *
                (tokenPrices(model)?.imageIn ?? 0)) /
              1e6,
            max: 0,
          };
  return {
    typical: round(output + price.input.typical + extra.typical),
    max: round(output + price.input.max + extra.max),
  };
}

// One generation per scene slot, at each slot's aspect. null when the model has
// no pinned price (the UI says so instead of guessing).
export function estimateScenes(
  slots: { aspect?: string }[],
  model: { provider: string; model: string; quality?: ImageQuality },
  references = 0,
): SceneEstimate | null {
  const price = imagePrice(model);
  if (!price) return null;
  const each = slots.map((s) =>
    estimateGeneration(model, s.aspect, references),
  );
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

// Video is billed by the second rendered, at a price per resolution: Veo 3.1
// (Google, 2026-10-06, audio included). Sora is retired; its rates stay so
// old outputs keep their cost.
const VIDEO_PER_SECOND: Record<
  string,
  Partial<Record<VideoResolution, number>>
> = {
  "google/veo-3.1-generate-preview": { "720p": 0.4, "1080p": 0.4 },
  "google/veo-3.1-fast-generate-preview": { "720p": 0.1, "1080p": 0.12 },
  "google/veo-3.1-lite-generate-preview": { "720p": 0.05, "1080p": 0.08 },
  "openai/sora-2": { "720p": 0.1 },
  "openai/sora-2-pro": { "720p": 0.3 },
};

// What `seconds` of video cost on this model at its resolution; null when it
// has no pinned price there.
export function videoCost(
  model: { provider: string; model: string; resolution?: VideoResolution },
  seconds: number,
): number | null {
  const resolution = model.resolution ?? DEFAULT_VIDEO_RESOLUTION;
  const perSecond = VIDEO_PER_SECOND[key(model)]?.[resolution];
  return perSecond === undefined ? null : round(perSecond * seconds);
}

// What one video of this length costs, before it is made: null when the model
// has no pinned price at that resolution or does not render that length there.
// Billing is by the seconds rendered, so the estimate is also the cost of a
// finished video.
export function estimateVideo(
  model: { provider: string; model: string; resolution?: VideoResolution },
  seconds: number,
): number | null {
  const resolution = model.resolution ?? DEFAULT_VIDEO_RESOLUTION;
  const lengths = modelEntry(model)?.seconds?.[resolution];
  if (!lengths?.includes(seconds)) return null;
  return videoCost(model, seconds);
}

// Token usage reported by the provider: what a finished call actually cost.
// `outputTokens` is the model's main output — the image of an image model, the
// text (thinking included) of a text model; `outputTextTokens` is the text and
// thinking an image model writes beside its image.
export interface GenerationUsage {
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
  outputTextTokens?: number;
}

export function costFromUsage(
  model: { provider: string; model: string },
  usage: GenerationUsage,
): number | null {
  const p = tokenPrices(model);
  if (!p) return null;
  const isText = modelEntry(model)?.kind === "text";
  const input =
    usage.inputTextTokens * p.textIn + usage.inputImageTokens * p.imageIn;
  const output = isText
    ? usage.outputTokens * p.textOut
    : usage.outputTokens * p.imageOut +
      (usage.outputTextTokens ?? 0) * p.textOut;
  return (input + output) / 1_000_000;
}

// What each text call may read and write: the adapters send the output cap
// (`max_output_tokens` / `maxOutputTokens`, thinking included) and the cap
// reservation prices both, so a text call's cost is bounded before it runs.
export const TEXT_CALL_BUDGETS = {
  // The prompt and one product photo.
  vision: { inputTokens: 4_000, outputTokens: 3_000 },
  // The prompt, the understanding and the slots; one direction per slot.
  artDirection: { inputTokens: 3_000, outputTokens: 6_000 },
  // The prompt and one product photo; a short product draft.
  productDraft: { inputTokens: 4_000, outputTokens: 2_000 },
  // The spec, the rules and the free draft; a title, a description, 13 tags.
  listingCopy: { inputTokens: 3_000, outputTokens: 3_000 },
  // The product form, each field with its use; a few suggestions and checks.
  productReview: { inputTokens: 3_000, outputTokens: 2_000 },
  // One step of a chat turn: the instructions, Kiln's tools and the
  // conversation (old images left out); a reply or a tool call.
  chatTurn: { inputTokens: 20_000, outputTokens: 2_000 },
  // One step of a turn the maker asked to plan first.
  chatPlan: { inputTokens: 20_000, outputTokens: 4_000 },
} as const;
export type TextCallKind = keyof typeof TEXT_CALL_BUDGETS;

// A text call's allowance on a model at an effort: the output (thinking
// included) grows with the level the model runs at, up to the most it writes.
// At low it is the budget above.
export function textBudget(
  kind: TextCallKind,
  model: { provider: string; model: string },
  effort: Effort = DEFAULT_EFFORT,
): { inputTokens: number; outputTokens: number } {
  const base = TEXT_CALL_BUDGETS[kind];
  const most = modelEntry(model)?.maxOutput ?? Number.POSITIVE_INFINITY;
  return {
    inputTokens: base.inputTokens,
    outputTokens: Math.min(
      base.outputTokens * effortScale(effortOn(model, effort)),
      most,
    ),
  };
}

// The most a text call (vision, art direction) can cost: its input allowance
// and the output cap it is sent with (`max_output_tokens`, thinking included).
export function textEstimate(
  model: { provider: string; model: string },
  budget: { inputTokens: number; outputTokens: number },
): number | null {
  if (modelEntry(model)?.kind !== "text") return null;
  const p = tokenPrices(model);
  if (!p) return null;
  return round(
    (budget.inputTokens * Math.max(p.textIn, p.imageIn) +
      budget.outputTokens * p.textOut) /
      1_000_000,
  );
}

// Whether a model has a pinned price for what Kiln would ask of it: an image
// at its quality, a video at some length at its resolution, a text call.
export function modelPriced(
  model: {
    provider: string;
    model: string;
    quality?: ImageQuality;
    resolution?: VideoResolution;
  },
  kind: "image" | "video" | "text",
): boolean {
  if (kind === "image") return imagePrice(model) !== undefined;
  if (kind === "text") {
    return textEstimate(model, { inputTokens: 1, outputTokens: 1 }) !== null;
  }
  const resolution = model.resolution ?? DEFAULT_VIDEO_RESOLUTION;
  return (modelEntry(model)?.seconds?.[resolution] ?? []).some(
    (s) => estimateVideo(model, s) !== null,
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
