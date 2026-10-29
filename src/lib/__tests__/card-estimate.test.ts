import { describe, expect, it } from "vitest";
import { cardEstimate, estimateHint, sumEstimates } from "@/lib/card-estimate";

const image = {
  type: "image" as const,
  model: {
    provider: "openai" as const,
    model: "gpt-image-2",
    aspect: "1:1",
    guidance: 7.5,
    strength: 0.65,
    quality: "medium" as const,
  },
  references: [],
};

describe("a studio card's price", () => {
  it("prices an image on its model and a video by its length", () => {
    expect(cardEstimate(image)).not.toBeNull();
    const video = cardEstimate({
      type: "video",
      model: {
        ...image.model,
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
      },
      references: [],
      video: { durationSec: 8, motion: "light", startFrameAssetId: null },
    });
    expect(video).toEqual({ typical: 0.8, max: 0.8 });
    expect(estimateHint({ typical: 0.8, max: 0.8 })).toBe("$0.80");
    expect(estimateHint({ typical: 0.05, max: 0.06 })).toBe("≈ $0.05–0.06");
  });

  it("adds several, and says nothing is known when one has no price", () => {
    expect(
      sumEstimates([
        { typical: 0.05, max: 0.06 },
        { typical: 0.1, max: 0.12 },
      ]),
    ).toEqual({ typical: 0.15, max: 0.18 });
    expect(sumEstimates([{ typical: 0.05, max: 0.06 }, null])).toBeNull();
    expect(
      cardEstimate({ ...image, model: { ...image.model, model: "unpriced" } }),
    ).toBeNull();
  });
});
