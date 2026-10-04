import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("KILN_PROVIDERS=mock", () => {
  it("forces the stubs even when keys are set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    vi.stubEnv("KILN_PROVIDERS", "mock");
    const openai = await import("@/providers/openai/client");
    const google = await import("@/providers/google/client");
    const { providerMode } = await import("@/providers/mode");
    expect(openai.hasOpenAIKey()).toBe(false);
    expect(google.hasGoogleKey()).toBe(false);
    expect(providerMode()).toBe("mock");
  });

  it("is live by default", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("KILN_PROVIDERS", "");
    const openai = await import("@/providers/openai/client");
    expect(openai.hasOpenAIKey()).toBe(true);
  });

  it("stub URLs are unique, so a mock re-roll is a new output", async () => {
    vi.stubEnv("KILN_PROVIDERS", "mock");
    const { openaiImageProvider } = await import("@/providers/openai/image");
    const input = {
      masterAssetUrl: "https://stub.local/m.png",
      prompt: "p",
      imageInputs: [],
      negative: "",
      model: {
        provider: "openai" as const,
        model: "gpt-image-2",
        aspect: "1:1",
        guidance: 7.5,
        strength: 0.65,
      },
    };
    const a = await openaiImageProvider.edit(input);
    const b = await openaiImageProvider.edit(input);
    expect(a.assets[0].url).not.toBe(b.assets[0].url);
  });
});
