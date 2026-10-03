import { describe, expect, it } from "vitest";
import { estimateScenes, imagePrice } from "@/domain/generation-cost";
import { DEFAULT_MODEL_IDS } from "@/domain/model-defaults";

describe("generation cost", () => {
  it("prices every catalog default image model", () => {
    for (const provider of ["openai", "google"] as const) {
      expect(
        imagePrice({ provider, model: DEFAULT_MODEL_IDS[provider].image }),
      ).toBeDefined();
    }
  });

  it("sums one generation per scene; non-square OpenAI sizes cost 1.5x", () => {
    const e = estimateScenes([{ aspect: "1:1" }, { aspect: "4:5" }], {
      provider: "openai",
      model: "gpt-image-2",
    });
    expect(e).toEqual({
      count: 2,
      typical: 0.1325,
      max: 0.5275,
      confidence: "official",
    });
  });

  it("Gemini charges per 1K image whatever the aspect", () => {
    const e = estimateScenes([{ aspect: "1:1" }, { aspect: "9:16" }], {
      provider: "google",
      model: "gemini-3.1-flash-image",
    });
    expect(e?.typical).toBe(0.134);
    expect(e?.max).toBe(0.134);
  });

  it("returns null for a model without a pinned price", () => {
    expect(
      estimateScenes([{}], { provider: "openai", model: "gpt-image-9" }),
    ).toBeNull();
  });
});
