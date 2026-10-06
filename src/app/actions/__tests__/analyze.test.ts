import { describe, expect, it } from "vitest";
import { analyzeMaster } from "@/app/actions/analyze";

describe("analyzeMaster", () => {
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
      message: "OpenAI has no API key (OPENAI_API_KEY is not set).",
      alternative: {
        provider: "google",
        model: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        usd: 0.033,
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
      message: "Google has no API key (GOOGLE_API_KEY is not set).",
      alternative: { provider: "openai", model: "gpt-6.1-sol" },
    });
  });

  it("rejects an empty asset URL", async () => {
    await expect(analyzeMaster({ assetUrl: "" })).rejects.toThrow();
  });
});
