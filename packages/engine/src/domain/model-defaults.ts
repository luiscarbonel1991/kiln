// Default model IDs — pure and client-safe (no env). MODELS (@/providers/models)
// layers env overrides on top; the client (card display, buildCards) reads these
// directly so it never imports the env-bound providers layer. IDs verified current
// mid-2026 (see PROVIDERS research): Gemini 3.1 Flash Image ("Nano Banana 2"),
// Gemini 3.5 Flash (vision/JSON), Veo 3.1, OpenAI gpt-image-2.
export const DEFAULT_MODEL_IDS = {
  google: {
    image: "gemini-3.1-flash-image",
    vision: "gemini-3.5-flash",
    video: "veo-3.1-generate-preview",
  },
  openai: { image: "gpt-image-2", video: "sora-2" },
} as const;

// The provider a NEW card starts on (image and video). One switch: cards,
// promoted video cards and the bare generate action all read it. OpenAI since
// 2026-09-18 while the Google spend cap is exhausted; the picker still offers both.
export const DEFAULT_PROVIDER: "google" | "openai" = "openai";
export const defaultImageModel = () => ({
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL_IDS[DEFAULT_PROVIDER].image,
});
export const defaultVideoModel = () => ({
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL_IDS[DEFAULT_PROVIDER].video,
});

// The quality every OpenAI image request is sent with (generate, edit and the
// queue). Pinned so a scene's cost is known before it is paid: with "auto" the
// model picks per image (medium chosen by Luis, 2026-10-04). The cost estimate
// reads the same constant.
export type ImageQuality = "low" | "medium" | "high";
export const OPENAI_IMAGE_QUALITY: ImageQuality = "medium";

// The models a card may switch between — the UI pickers' source of truth AND the
// adapters' allowlist (a card's model id is client-supplied; anything outside the
// catalog falls back to the provider default). IDs verified live against both
// providers' model listings (Sept 2026). Quality order within each provider.
export interface ModelChoice {
  provider: "google" | "openai";
  id: string;
  label: string;
}

export const IMAGE_MODEL_CATALOG: ModelChoice[] = [
  { provider: "google", id: "gemini-3-pro-image", label: "Gemini 3 Pro Image" },
  {
    provider: "google",
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
  },
  {
    provider: "google",
    id: "gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash-Lite Image",
  },
  { provider: "openai", id: "gpt-image-2", label: "GPT Image 2" },
  { provider: "openai", id: "gpt-image-1.5", label: "GPT Image 1.5" },
  { provider: "openai", id: "gpt-image-1-mini", label: "GPT Image 1 Mini" },
];

export const VIDEO_MODEL_CATALOG: ModelChoice[] = [
  {
    provider: "google",
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1",
  },
  {
    provider: "google",
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
  },
  {
    provider: "google",
    id: "veo-3.1-lite-generate-preview",
    label: "Veo 3.1 Lite",
  },
  { provider: "openai", id: "sora-2", label: "Sora 2" },
  { provider: "openai", id: "sora-2-pro", label: "Sora 2 Pro" },
];

// Generation policy (Luis, 2026-10-02: "always use the OpenAI API, not Google's,
// to generate"). The Google adapters stay in the engine — the architecture is
// multiprovider — but no image or video generation is sent to them: new cards
// start on OpenAI, the pickers list OpenAI models only, and a card saved on
// Google moves to the OpenAI default the moment it generates again (its current
// output keeps the model that made it). The generation actions enforce it too.
export const GENERATION_PROVIDERS: readonly ("google" | "openai")[] = [
  "openai",
];

export function generationModel<
  T extends { provider: "google" | "openai"; model: string },
>(model: T, kind: "image" | "video"): T {
  if (GENERATION_PROVIDERS.includes(model.provider)) return model;
  const fallback = kind === "video" ? defaultVideoModel() : defaultImageModel();
  return { ...model, provider: fallback.provider, model: fallback.model };
}

export function generationCatalog(kind: "image" | "video"): ModelChoice[] {
  const catalog = kind === "video" ? VIDEO_MODEL_CATALOG : IMAGE_MODEL_CATALOG;
  return catalog.filter((m) => GENERATION_PROVIDERS.includes(m.provider));
}
