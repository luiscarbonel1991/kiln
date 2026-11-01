import { z } from "zod";
import type { Effort } from "@/domain/effort";

// The models Kiln generates with, by kind and provider (Luis, 2026-10-06:
// several models from both providers, not one provider). Pure and client-safe:
// the pickers' source of truth and the server's allowlist, since a card's model
// is client-supplied. Ids verified 2026-10-06 against each API's model list
// (OpenAI GET /v1/models, Gemini GET v1beta/models). Every entry that is not
// retired has a pinned price (generation-cost.ts), or the queue refuses it.
// Nothing ever switches provider on its own: a model that cannot run is refused
// with the reason, never swapped for another.

export const ProviderId = z.enum(["google", "openai"]);
export type ProviderId = z.infer<typeof ProviderId>;
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  google: "Google",
};

export type ModelKind = "image" | "video" | "text";

export const ImageQuality = z.enum(["low", "medium", "high"]);
export type ImageQuality = z.infer<typeof ImageQuality>;
export const VideoResolution = z.enum(["720p", "1080p"]);
export type VideoResolution = z.infer<typeof VideoResolution>;

export interface ModelEntry {
  kind: ModelKind;
  provider: ProviderId;
  id: string;
  label: string;
  // An announced shutdown: still offered, marked with the date.
  retires?: string;
  // Deprecated by its provider with no shutdown announced: still offered and
  // run, marked with the date.
  deprecated?: string;
  // Shut down: only labels the outputs it made, never offered or run.
  retired?: string;
  // Retired: the model its provider answers it with now.
  replacedBy?: string;
  // Image: the qualities the request may be sent with.
  qualities?: readonly ImageQuality[];
  // Video: the lengths it renders at each resolution it offers.
  seconds?: Partial<Record<VideoResolution, readonly number[]>>;
  // Text: the effort levels it offers (domain/effort.ts), the most it writes
  // in one call (thinking included), and whether it reads images.
  efforts?: readonly Effort[];
  maxOutput?: number;
  sees?: boolean;
}

const QUALITIES: readonly ImageQuality[] = ["low", "medium", "high"];
// Veo 3.1 (all three, shut down by Google on 2026-10-22): 4, 6 or 8 s at
// 720p; 1080p only at 8 s (ai.google.dev/gemini-api/docs/veo, 2026-10-06).
const VEO_SECONDS = { "720p": [4, 6, 8], "1080p": [8] } as const;
// Gemini Omni Flash: 3 to 10 s. Only 720p, the one resolution Google prices
// (1080p and 4K are upscaled from it, unpriced).
const OMNI_SECONDS = { "720p": [3, 4, 5, 6, 7, 8, 9, 10] } as const;
// Text, from each model's page (2026-10-31): OpenAI's reasoning effort takes
// every level, up to 128,000 output tokens; Gemini thinks at low, medium or
// high, up to 65,536. Every one reads images.
const OPENAI_TEXT = {
  efforts: ["low", "medium", "high", "xhigh", "max"],
  maxOutput: 128_000,
  sees: true,
} as const;
const GEMINI_TEXT = {
  efforts: ["low", "medium", "high"],
  maxOutput: 65_536,
  sees: true,
} as const;

export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    kind: "image",
    provider: "openai",
    id: "gpt-image-2",
    label: "GPT Image 2",
    qualities: QUALITIES,
  },
  {
    kind: "image",
    provider: "openai",
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    retires: "2026-12-01",
    qualities: QUALITIES,
  },
  {
    kind: "image",
    provider: "openai",
    id: "gpt-image-1-mini",
    label: "GPT Image 1 Mini",
    retires: "2026-12-01",
    qualities: QUALITIES,
  },
  // Nano Banana 2.1, verified 2026-10-31 (GET v1beta/models): Nano Banana 2's
  // update, with better text rendering, at half its price.
  {
    kind: "image",
    provider: "google",
    id: "gemini-nano-banana-2.1",
    label: "Gemini Nano Banana 2.1",
  },
  {
    kind: "image",
    provider: "google",
    id: "gemini-3-pro-image",
    label: "Gemini 3 Pro Image",
  },
  {
    kind: "image",
    provider: "google",
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    deprecated: "2026-10-06",
  },
  {
    kind: "image",
    provider: "google",
    id: "gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash-Lite Image",
  },
  // Video. Gemini Omni Flash, verified 2026-10-31 (GET v1beta/models, and one
  // render through the Interactions API): 24 fps, 9:16 or 16:9, with sound.
  {
    kind: "video",
    provider: "google",
    id: "gemini-omni-1.1-flash",
    label: "Gemini Omni Flash",
    seconds: OMNI_SECONDS,
  },
  {
    kind: "video",
    provider: "google",
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1",
    retired: "2026-10-22",
    seconds: VEO_SECONDS,
  },
  {
    kind: "video",
    provider: "google",
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
    retired: "2026-10-22",
    seconds: VEO_SECONDS,
  },
  {
    kind: "video",
    provider: "google",
    id: "veo-3.1-lite-generate-preview",
    label: "Veo 3.1 Lite",
    retired: "2026-10-22",
    seconds: VEO_SECONDS,
  },
  {
    kind: "video",
    provider: "openai",
    id: "sora-2",
    label: "Sora 2",
    retired: "2026-09-24",
    seconds: { "720p": [4, 8, 12] },
  },
  {
    kind: "video",
    provider: "openai",
    id: "sora-2-pro",
    label: "Sora 2 Pro",
    retired: "2026-09-24",
    seconds: { "720p": [4, 8, 12] },
  },
  // Text, ids verified 2026-10-31 (GET /v1/models, GET v1beta/models). Each
  // provider's default first: the other provider's offer when a call fails.
  {
    kind: "text",
    provider: "openai",
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    ...OPENAI_TEXT,
  },
  {
    kind: "text",
    provider: "openai",
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    ...OPENAI_TEXT,
  },
  {
    kind: "text",
    provider: "openai",
    id: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    ...OPENAI_TEXT,
  },
  {
    kind: "text",
    provider: "openai",
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    ...OPENAI_TEXT,
  },
  {
    kind: "text",
    provider: "google",
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    ...GEMINI_TEXT,
  },
  {
    kind: "text",
    provider: "google",
    id: "gemini-4-argon",
    label: "Gemini 4 Argon",
    ...GEMINI_TEXT,
  },
  {
    kind: "text",
    provider: "google",
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    ...GEMINI_TEXT,
  },
  {
    kind: "text",
    provider: "google",
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    ...GEMINI_TEXT,
  },
  // Deprecated by Google on 2026-10-08 with no shutdown: its requests are
  // answered by Gemini 3.6 Flash, at a price Google does not state.
  {
    kind: "text",
    provider: "google",
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    retired: "2026-10-08",
    replacedBy: "gemini-3.6-flash",
    ...GEMINI_TEXT,
  },
];

// What a picker offers for a kind: everything not retired, OpenAI first.
export function catalogFor(kind: ModelKind): ModelEntry[] {
  return MODEL_CATALOG.filter((m) => m.kind === kind && !m.retired);
}

// Any entry, retired ones included (to label an old output).
export function modelEntry(model: {
  provider: string;
  model: string;
}): ModelEntry | undefined {
  return MODEL_CATALOG.find(
    (m) => m.provider === model.provider && m.id === model.model,
  );
}

// "Veo 3.1 Fast", "Sora 2 (retired)", or the bare id when unknown.
export function modelLabel(model: { provider: string; model: string }): string {
  const entry = modelEntry(model);
  if (!entry) return model.model;
  return entry.retired ? `${entry.label} (retired)` : entry.label;
}

export type ModelCheck =
  | { ok: true; entry: ModelEntry }
  | { ok: false; reason: "retired" | "unknown"; message: string };

// Whether a model may run for this kind. A retired or unknown model is refused
// with a reason the maker can act on; it is never replaced by another.
export function checkModel(
  model: { provider: string; model: string },
  kind: ModelKind,
): ModelCheck {
  const entry = modelEntry(model);
  if (!entry || entry.kind !== kind) {
    return {
      ok: false,
      reason: "unknown",
      message: `"${model.model}" is not a ${kind} model Kiln offers — pick one in the model picker.`,
    };
  }
  if (entry.retired) {
    const after = entry.replacedBy
      ? modelEntry({ provider: entry.provider, model: entry.replacedBy })
      : undefined;
    return {
      ok: false,
      reason: "retired",
      message: after
        ? `${entry.label} was retired on ${entry.retired}: ${PROVIDER_LABELS[entry.provider]} answers it with ${after.label} — pick that or another ${kind} model.`
        : `${entry.label} was shut down on ${entry.retired} — pick another ${kind} model.`,
    };
  }
  return { ok: true, entry };
}

export class ModelRefused extends Error {
  readonly name = "ModelRefused";
}

export function assertModel(
  model: { provider: string; model: string },
  kind: ModelKind,
): ModelEntry {
  const check = checkModel(model, kind);
  if (!check.ok) throw new ModelRefused(check.message);
  return check.entry;
}

// The quality an OpenAI image request is sent with when the card names none.
// Pinned so a scene's cost is known before it is paid (with "auto" the model
// picks per image; medium chosen by Luis, 2026-10-04).
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "medium";
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "720p";

// The maker's default model per kind (Settings → Models): what a new card
// starts on and what vision and the art director run on. A card overrides its
// own; the defaults never change a card already made.
export const MakerModels = z.object({
  image: z.object({
    provider: ProviderId,
    model: z.string().min(1),
    quality: ImageQuality.optional(),
  }),
  video: z.object({
    provider: ProviderId,
    model: z.string().min(1),
    resolution: VideoResolution.optional(),
  }),
  text: z.object({ provider: ProviderId, model: z.string().min(1) }),
});
export type MakerModels = z.infer<typeof MakerModels>;

// Images on gpt-image-2 medium (proven on the first maker's launch); video on
// Veo 3.1 Fast 720p (Sora is gone); text on gpt-6.1-sol (Luis, 2026-10-06).
export const DEFAULT_MAKER_MODELS: MakerModels = {
  image: { provider: "openai", model: "gpt-image-2", quality: "medium" },
  video: {
    provider: "google",
    model: "gemini-omni-1.1-flash",
    resolution: "720p",
  },
  text: { provider: "openai", model: "gpt-6.1-sol" },
};

// A maker's saved defaults, read leniently: a kind that is missing, malformed
// or no longer offered reads as Kiln's default for that kind (the settings page
// shows what is in effect).
export function makerModels(raw: unknown): MakerModels {
  const saved = (raw ?? {}) as Record<string, unknown>;
  const pick = <K extends keyof MakerModels>(kind: K): MakerModels[K] => {
    const parsed = MakerModels.shape[kind].safeParse(saved[kind]);
    return parsed.success && checkModel(parsed.data, kind).ok
      ? (parsed.data as MakerModels[K])
      : DEFAULT_MAKER_MODELS[kind];
  };
  return { image: pick("image"), video: pick("video"), text: pick("text") };
}

export const defaultImageModel = (
  models: MakerModels = DEFAULT_MAKER_MODELS,
) => ({ ...models.image });
export const defaultVideoModel = (
  models: MakerModels = DEFAULT_MAKER_MODELS,
) => ({ ...models.video });
export const defaultTextModel = (
  models: MakerModels = DEFAULT_MAKER_MODELS,
) => ({
  ...models.text,
});
