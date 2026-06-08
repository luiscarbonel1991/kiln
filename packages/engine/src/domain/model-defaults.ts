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
  openai: { image: "gpt-image-2" },
} as const;
