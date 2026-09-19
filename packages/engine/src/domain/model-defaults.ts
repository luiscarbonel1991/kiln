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
