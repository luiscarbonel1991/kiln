import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeMaster } from "@/app/actions/analyze";

// Kiln's defaults, never the shared test maker's saved routes: the
// maker-repository suite writes them while other files run.
vi.mock("@/server/maker-repository", async (original) => {
  const { DEFAULT_MAKER_MODELS } = await import("@/domain/model-defaults");
  return {
    ...(await original<typeof import("@/server/maker-repository")>()),
    getMakerModelSetup: async () => ({
      models: DEFAULT_MAKER_MODELS,
      routes: null,
      agents: {},
    }),
  };
});

describe("analyzeMaster", () => {
  // The offer's price is dated: read it before Google's change.
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-10-31T12:00:00Z"),
      toFake: ["Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says it degraded when the text model cannot run (no key), and offers the other provider", async () => {
    const { understanding, degraded } = await analyzeMaster({
      assetUrl: "https://stub.local/x.png",
    });
    expect(understanding.subject).toBe(
      "the exact product shown in the master image",
    );
    expect(understanding.palette.length).toBeGreaterThan(0);
    expect(degraded).toMatchObject({
      provider: "openai",
      model: "gpt-6.1-sol",
      label: "GPT-6.1 Sol",
      message:
        "OpenAI has no API key: add one in Settings → Providers, or set OPENAI_API_KEY.",
      alternative: {
        provider: "google",
        model: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        usd: 0.0143,
      },
    });
  });

  it("runs on the model the maker names", async () => {
    const { degraded } = await analyzeMaster({
      assetUrl: "https://stub.local/x.png",
      model: { provider: "google", model: "gemini-3.8-flash" },
    });
    expect(degraded).toMatchObject({
      provider: "google",
      model: "gemini-3.8-flash",
      message:
        "Google has no API key: add one in Settings → Providers, or set GOOGLE_API_KEY.",
      alternative: { provider: "openai", model: "gpt-6.1-sol" },
    });
  });

  it("rejects an empty asset URL", async () => {
    await expect(analyzeMaster({ assetUrl: "" })).rejects.toThrow();
  });
});
