import { describe, expect, it, vi } from "vitest";
import { animateVideo } from "@/app/actions/animate";
import type { AnimateInput } from "@/providers/types";

// A direct call is refused when its provider has no key in reach, so the
// studio counts as keyed here. Only that answer is a fixture: the adapters
// still find no key and take their stubs, so nothing is asked or paid.
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: () => true,
}));

const sampleInput: AnimateInput = {
  startFrameAssetId: "asset-master",
  prompt: "edit(master) -> subject",
  motion: "subtle push-in",
  durationSec: 5,
  model: {
    provider: "google",
    model: "gemini-omni-1.1-flash",
    aspect: "9:16",
    guidance: 7.5,
    strength: 0.65,
  },
};

describe("animateVideo", () => {
  it("animates a card on Gemini Omni Flash (mock without a key)", async () => {
    const result = await animateVideo(sampleInput);
    expect(result.provider).toBe("google");
    expect(result.model).toBe("gemini-omni-1.1-flash");
    expect(result.assets[0].mime).toBe("video/mp4");
  });

  it("refuses Veo, which Google shut down, instead of swapping it", async () => {
    await expect(
      animateVideo({
        ...sampleInput,
        model: { ...sampleInput.model, model: "veo-3.1-fast-generate-preview" },
      }),
    ).rejects.toThrow(/Veo 3\.1 Fast was shut down on 2026-10-22/);
  });

  it("refuses Sora, which OpenAI shut down, instead of swapping it", async () => {
    await expect(
      animateVideo({
        ...sampleInput,
        model: { ...sampleInput.model, provider: "openai", model: "sora-2" },
      }),
    ).rejects.toThrow(/Sora 2 was shut down on 2026-09-24/);
  });

  it("rejects a payload missing the start frame", async () => {
    // @ts-expect-error — exercising the Zod trust boundary with a bad payload
    await expect(animateVideo({ prompt: "x" })).rejects.toThrow();
  });
});
