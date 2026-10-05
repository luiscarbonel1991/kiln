import { describe, expect, it } from "vitest";
import {
  canAfford,
  costFromUsage,
  estimateGeneration,
  estimateScenes,
  imagePrice,
  toMicros,
} from "@/domain/generation-cost";
import {
  DEFAULT_MODEL_IDS,
  OPENAI_IMAGE_QUALITY,
} from "@/domain/model-defaults";

describe("generation cost", () => {
  it("prices every catalog default image model", () => {
    for (const provider of ["openai", "google"] as const) {
      expect(
        imagePrice({ provider, model: DEFAULT_MODEL_IDS[provider].image }),
      ).toBeDefined();
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
    expect(OPENAI_IMAGE_QUALITY).toBe("medium");
    expect(
      imagePrice({ provider: "openai", model: "gpt-image-2" }),
    ).toMatchObject({
      quality: OPENAI_IMAGE_QUALITY,
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
    expect(e?.typical).toBe(0.134);
    expect(e?.max).toBe(0.136);
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
    expect(costFromUsage("gpt-image-2", usage)).toBeCloseTo(0.129, 6);
    expect(costFromUsage("gpt-image-1-mini", usage)).toBeCloseTo(0.0349, 6);
    expect(costFromUsage("gemini-3.1-flash-image", usage)).toBeNull();
  });

  it("estimates one generation per model and aspect", () => {
    expect(
      estimateGeneration({ provider: "openai", model: "gpt-image-2" }, "1:1"),
    ).toEqual({ typical: 0.063, max: 0.073 });
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
