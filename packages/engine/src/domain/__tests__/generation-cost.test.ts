import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canAfford,
  costFromUsage,
  estimateGeneration,
  estimateScenes,
  estimateVideo,
  imagePrice,
  textEstimate,
  toMicros,
  videoCost,
} from "@/domain/generation-cost";
import { catalogFor, DEFAULT_IMAGE_QUALITY } from "@/domain/model-defaults";

const veo = (model: string, resolution?: "720p" | "1080p") => ({
  provider: "google",
  model,
  resolution,
});

describe("video cost", () => {
  it("prices Veo by the second at its resolution (ai.google.dev, 2026-10-06)", () => {
    expect(estimateVideo(veo("veo-3.1-fast-generate-preview"), 8)).toBe(0.8);
    expect(
      estimateVideo(veo("veo-3.1-fast-generate-preview", "1080p"), 8),
    ).toBe(0.96);
    expect(estimateVideo(veo("veo-3.1-lite-generate-preview"), 6)).toBe(0.3);
    expect(
      estimateVideo(veo("veo-3.1-lite-generate-preview", "1080p"), 8),
    ).toBe(0.64);
    expect(estimateVideo(veo("veo-3.1-generate-preview"), 8)).toBe(3.2);
    expect(estimateVideo(veo("veo-3.1-generate-preview", "1080p"), 8)).toBe(
      3.2,
    );
  });

  it("has no estimate for a length the model does not render there", () => {
    expect(estimateVideo(veo("veo-3.1-fast-generate-preview"), 12)).toBeNull();
    expect(
      estimateVideo(veo("veo-3.1-fast-generate-preview", "1080p"), 6),
    ).toBeNull();
    expect(estimateVideo(veo("veo-9"), 8)).toBeNull();
  });

  it("prices Gemini Omni Flash by its tokens: 5,792 a second at $17.50 per 1M, plus a clip's input and thinking", () => {
    const omni = veo("gemini-omni-1.1-flash");
    expect(estimateVideo(omni, 5)).toBe(0.517);
    expect(estimateVideo(omni, 8)).toBe(0.8212);
    expect(estimateVideo(omni, 10)).toBe(1.024);
    expect(estimateVideo(omni, 11)).toBeNull();
    expect(estimateVideo(veo("gemini-omni-1.1-flash", "1080p"), 8)).toBeNull();
    // The clip measured on 2026-10-31: 1,233 in, 28,960 video, 352 thinking.
    const measured = costFromUsage(omni, {
      inputTextTokens: 133,
      inputImageTokens: 1100,
      outputTokens: 28960,
      outputTextTokens: 352,
    });
    expect(measured).toBeCloseTo(0.5118, 4);
    expect(measured ?? 1).toBeLessThan(estimateVideo(omni, 5) ?? 0);
  });

  it("keeps Sora's rates for old outputs only", () => {
    expect(videoCost({ provider: "openai", model: "sora-2" }, 12)).toBe(1.2);
  });

  it("prices every video model the catalog offers, at every length it renders", () => {
    for (const m of catalogFor("video")) {
      for (const [resolution, lengths] of Object.entries(m.seconds ?? {})) {
        for (const s of lengths ?? []) {
          expect(
            estimateVideo(
              {
                provider: m.provider,
                model: m.id,
                resolution: resolution as "720p" | "1080p",
              },
              s,
            ),
          ).not.toBeNull();
        }
      }
    }
  });
});

describe("text cost", () => {
  // Some text prices are dated: read them on a day before any change.
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prices every text model the catalog offers", () => {
    for (const m of catalogFor("text")) {
      expect(
        textEstimate(
          { provider: m.provider, model: m.id },
          { inputTokens: 1000, outputTokens: 1000 },
        ),
      ).not.toBeNull();
    }
  });

  it("bounds a call by its input allowance and its output cap", () => {
    // gpt-6.1-sol: $2 in, $10 out per 1M.
    expect(
      textEstimate(
        { provider: "openai", model: "gpt-6.1-sol" },
        { inputTokens: 4000, outputTokens: 2000 },
      ),
    ).toBe(0.028);
    expect(
      textEstimate(
        { provider: "google", model: "gemini-3.8-flash" },
        { inputTokens: 4000, outputTokens: 2000 },
      ),
    ).toBe(0.0105);
    expect(
      textEstimate(
        { provider: "google", model: "gemini-3.1-flash-image" },
        { inputTokens: 1, outputTokens: 1 },
      ),
    ).toBeNull();
  });

  it("reads the price a provider dated from its day on", () => {
    const call = { inputTokens: 10_000, outputTokens: 10_000 };
    const argon = { provider: "google", model: "gemini-4-argon" };
    const flash = { provider: "google", model: "gemini-3.8-flash" };
    // $2 in, $10 out per 1M through November; $4 and $20 from December 1.
    expect(textEstimate(argon, call)).toBe(0.12);
    vi.setSystemTime(new Date("2026-11-30T23:59:00Z"));
    expect(textEstimate(argon, call)).toBe(0.12);
    vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
    expect(textEstimate(argon, call)).toBe(0.24);
    expect(textEstimate(flash, call)).toBe(0.045);
    // The Flash models double on 2027-01-01, and so does what a call costs.
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(textEstimate(flash, call)).toBe(0.09);
    expect(
      costFromUsage(flash, {
        inputTextTokens: 10_000,
        inputImageTokens: 0,
        outputTokens: 10_000,
      }),
    ).toBe(0.09);
  });

  it("measures a text call from its usage, thinking billed as output", () => {
    expect(
      costFromUsage(
        { provider: "google", model: "gemini-3.8-flash" },
        { inputTextTokens: 600, inputImageTokens: 1100, outputTokens: 900 },
      ),
    ).toBeCloseTo((1700 * 0.75 + 900 * 3.75) / 1e6, 9);
  });
});

describe("generation cost", () => {
  it("prices every image model the catalog offers", () => {
    for (const m of catalogFor("image")) {
      expect(imagePrice({ provider: m.provider, model: m.id })).toBeDefined();
    }
  });

  it("sums one generation per scene at the pinned quality, by size, plus the edit's input allowance", () => {
    // gpt-image-2 medium: $0.053 square, $0.041 portrait (cheaper, per the
    // official table); input $0.01 typical, $0.02 at most.
    const e = estimateScenes([{ aspect: "1:1" }, { aspect: "4:5" }], {
      provider: "openai",
      model: "gpt-image-2",
    });
    expect(e).toEqual({
      count: 2,
      typical: 0.114,
      max: 0.134,
      quality: "medium",
      confidence: "official",
    });
  });

  it("reads the row of the quality the requests are sent with", () => {
    expect(DEFAULT_IMAGE_QUALITY).toBe("medium");
    expect(
      imagePrice({ provider: "openai", model: "gpt-image-2" }),
    ).toMatchObject({
      quality: DEFAULT_IMAGE_QUALITY,
      output: { square: 0.053, nonSquare: 0.041 },
    });
    expect(
      estimateGeneration(
        { provider: "openai", model: "gpt-image-1-mini" },
        "4:5",
      ),
    ).toEqual({ typical: 0.025, max: 0.035 });
  });

  it("Gemini charges per 1K image whatever the aspect", () => {
    const e = estimateScenes([{ aspect: "1:1" }, { aspect: "9:16" }], {
      provider: "google",
      model: "gemini-3.1-flash-image",
    });
    // $0.067 per image plus the reference and prompt read in ($0.0009
    // typical, $0.0025 at most).
    expect(e?.typical).toBe(0.1358);
    expect(e?.max).toBe(0.139);
    expect(e?.quality).toBeNull();
  });

  it("returns null for a model without a pinned price", () => {
    expect(
      estimateScenes([{}], { provider: "openai", model: "gpt-image-9" }),
    ).toBeNull();
  });
});

describe("actual cost and the monthly cap", () => {
  it("prices a finished generation from its token usage", () => {
    const usage = {
      inputTextTokens: 200,
      inputImageTokens: 1000,
      outputTokens: 4000,
    };
    expect(
      costFromUsage({ provider: "openai", model: "gpt-image-2" }, usage),
    ).toBeCloseTo(0.129, 6);
    expect(
      costFromUsage({ provider: "openai", model: "gpt-image-1-mini" }, usage),
    ).toBeCloseTo(0.0349, 6);
    expect(
      costFromUsage(
        { provider: "openai", model: "gemini-3.1-flash-image" },
        usage,
      ),
    ).toBeNull();
  });

  it("measures a Gemini image: the image at the image rate, text and thinking at the text rate", () => {
    // gemini-3.1-flash-image: $0.50 in, $60 image out, $3 text out per 1M; a
    // 1K image is 1,120 tokens ($0.0672).
    expect(
      costFromUsage(
        { provider: "google", model: "gemini-3.1-flash-image" },
        {
          inputTextTokens: 300,
          inputImageTokens: 1100,
          outputTokens: 1120,
          outputTextTokens: 200,
        },
      ),
    ).toBeCloseTo((1400 * 0.5 + 1120 * 60 + 200 * 3) / 1e6, 9);
  });

  it("estimates a Gemini image at its 1K price plus its input allowance", () => {
    expect(
      estimateGeneration(
        { provider: "google", model: "gemini-3.1-flash-image" },
        "4:5",
      ),
    ).toEqual({ typical: 0.0679, max: 0.0695 });
    expect(
      estimateGeneration({ provider: "google", model: "gemini-3-pro-image" }),
    ).toEqual({ typical: 0.1376, max: 0.144 });
  });

  it("reads the row of the card's quality", () => {
    expect(
      estimateGeneration(
        { provider: "openai", model: "gpt-image-2", quality: "high" },
        "1:1",
      ),
    ).toEqual({ typical: 0.221, max: 0.231 });
  });

  it("estimates one generation per model and aspect", () => {
    expect(
      estimateGeneration({ provider: "openai", model: "gpt-image-2" }, "1:1"),
    ).toEqual({ typical: 0.063, max: 0.073 });
  });

  it("a further reference (a material sample) adds its input", () => {
    expect(
      estimateGeneration(
        { provider: "openai", model: "gpt-image-2" },
        "1:1",
        1,
      ),
    ).toEqual({ typical: 0.072, max: 0.085 });
    // Gemini's input max already allows three more; the typical grows.
    const gemini = { provider: "google", model: "gemini-3.1-flash-image" };
    expect(estimateGeneration(gemini, "4:5", 1)).toEqual({
      typical: 0.0685,
      max: 0.0695,
    });
  });

  it("canAfford counts spent + reserved + the request, exactly up to the cap", () => {
    const cap = toMicros(25);
    expect(
      canAfford({
        spentMicros: toMicros(20),
        reservedMicros: toMicros(4),
        requestMicros: toMicros(1),
        capMicros: cap,
      }),
    ).toBe(true);
    expect(
      canAfford({
        spentMicros: toMicros(20),
        reservedMicros: toMicros(4),
        requestMicros: toMicros(1) + 1,
        capMicros: cap,
      }),
    ).toBe(false);
  });
});
