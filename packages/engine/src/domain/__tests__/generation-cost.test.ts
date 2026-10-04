import { describe, expect, it } from "vitest";
import {
  canAfford,
  costFromUsage,
  estimateGeneration,
  estimateScenes,
  imagePrice,
  toMicros,
} from "@/domain/generation-cost";
import { DEFAULT_MODEL_IDS } from "@/domain/model-defaults";

describe("generation cost", () => {
  it("prices every catalog default image model", () => {
    for (const provider of ["openai", "google"] as const) {
      expect(
        imagePrice({ provider, model: DEFAULT_MODEL_IDS[provider].image }),
      ).toBeDefined();
    }
  });

  it("sums one generation per scene; non-square OpenAI sizes cost 1.5x, plus the edit's input allowance", () => {
    const e = estimateScenes([{ aspect: "1:1" }, { aspect: "4:5" }], {
      provider: "openai",
      model: "gpt-image-2",
    });
    expect(e).toEqual({
      count: 2,
      typical: 0.1525,
      max: 0.5675,
      confidence: "official",
    });
  });

  it("Gemini charges per 1K image whatever the aspect", () => {
    const e = estimateScenes([{ aspect: "1:1" }, { aspect: "9:16" }], {
      provider: "google",
      model: "gemini-3.1-flash-image",
    });
    expect(e?.typical).toBe(0.134);
    expect(e?.max).toBe(0.136);
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
    ).toEqual({ typical: 0.063, max: 0.231 });
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
