import { describe, expect, it } from "vitest";
import { animateVideo } from "@/app/actions/animate";
import type { AnimateInput } from "@/providers/types";

const sampleInput: AnimateInput = {
  startFrameAssetId: "asset-master",
  prompt: "edit(master) -> subject",
  motion: "subtle push-in",
  durationSec: 5,
  model: {
    provider: "google",
    model: "veo-3.1-generate-preview",
    aspect: "9:16",
    guidance: 7.5,
    strength: 0.65,
  },
};

describe("animateVideo", () => {
  it("a video card saved on Google is animated on OpenAI (generation policy)", async () => {
    const result = await animateVideo(sampleInput);
    expect(result.provider).toBe("openai");
    expect(result.assets[0].mime).toBe("video/mp4");
  });

  it("routes an openai card to the Sora provider (mock without a key)", async () => {
    const result = await animateVideo({
      ...sampleInput,
      model: { ...sampleInput.model, provider: "openai", model: "sora-2" },
    });
    expect(result.provider).toBe("openai");
    expect(result.assets[0].mime).toBe("video/mp4");
  });

  it("rejects a payload missing the start frame", async () => {
    // @ts-expect-error — exercising the Zod trust boundary with a bad payload
    await expect(animateVideo({ prompt: "x" })).rejects.toThrow();
  });
});
