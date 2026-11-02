import { describe, expect, it } from "vitest";
import { priceHint } from "@/lib/model-prices";

describe("priceHint", () => {
  it("prices a video by the second, and 8 s with its clip allowance", () => {
    expect(
      priceHint(
        {
          provider: "google",
          model: "gemini-omni-1.1-flash",
          resolution: "720p",
        },
        "video",
      ),
    ).toBe("$0.10/s · 8 s $0.82");
    expect(
      priceHint({ provider: "google", model: "veo-9" }, "video"),
    ).toBeNull();
  });

  it("prices an image at a portrait 1K, or at a frame's aspect and size", () => {
    const gpt2 = { provider: "openai", model: "gpt-image-2" };
    // A 4:5 at 1024x1280 (DOGFOOD #78).
    expect(priceHint(gpt2, "image")).toBe("≈ $0.055/image");
    expect(priceHint(gpt2, "image", { aspect: "4:5", size: "2k" })).toBe(
      "≈ $0.081/image at 2K",
    );
    // A model without 2K is priced as it would run, at 1K.
    expect(
      priceHint({ provider: "openai", model: "gpt-image-1.5" }, "image", {
        aspect: "4:5",
        size: "2k",
      }),
    ).not.toContain("2K");
  });
});
