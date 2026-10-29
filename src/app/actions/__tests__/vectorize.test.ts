import { describe, expect, it } from "vitest";
import { vectorizeCardAction } from "@/app/actions/vectorize";

describe("vectorizeCardAction", () => {
  it("says why a trace failed instead of failing silently", async () => {
    const result = await vectorizeCardAction({
      imageUrl: "https://stub.local/line-art.png",
      mode: "outline",
    });
    expect(result).toEqual({
      error: expect.stringContaining("Could not trace this image"),
    });
  });
});
