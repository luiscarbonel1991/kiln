import { describe, expect, it } from "vitest";
import { animateVideo } from "@/app/actions/animate";
import type { AnimateInput } from "@/providers/types";

const sampleInput: AnimateInput = {
  startFrameAssetId: "asset-master",
  prompt: "edit(master) -> subject",
  motion: "subtle push-in",
  durationSec: 5,
};

describe("animateVideo", () => {
  it("returns a video GenerationResult from the google provider", async () => {
    const result = await animateVideo(sampleInput);
    expect(result.provider).toBe("google");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].mime).toBe("video/mp4");
  });

  it("rejects a payload missing the start frame", async () => {
    // @ts-expect-error — exercising the Zod trust boundary with a bad payload
    await expect(animateVideo({ prompt: "x" })).rejects.toThrow();
  });
});
