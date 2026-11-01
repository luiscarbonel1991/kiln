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
});
