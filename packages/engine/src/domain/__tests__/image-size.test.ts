import { describe, expect, it } from "vitest";
import {
  destinationImageSize,
  destinationTargetPx,
  OPENAI_2K,
  sizeOn,
} from "@/domain/image-size";
import { SEED_DESTINATIONS } from "@/domain/seed";

const destination = (id: string) => {
  const found = SEED_DESTINATIONS.find((d) => d.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("the size a scene is asked for", () => {
  it("is 2K where a 1K image would be stretched more than 1.25x to the destination's target", () => {
    expect(destinationImageSize("1:1", destination("etsy"))).toBe("2k");
    expect(destinationImageSize("4:5", destination("etsy"))).toBe("2k");
    expect(destinationImageSize("1:1", destination("amazon"))).toBe("2k");
    expect(destinationImageSize("4:5", destination("instagram"))).toBe("1k");
    expect(destinationImageSize("9:16", destination("instagram"))).toBe("1k");
    // A studio card has no destination.
    expect(destinationImageSize("1:1", undefined)).toBe("1k");
  });

  it("reads the target for the aspect, else the largest the destination names", () => {
    expect(destinationTargetPx("4:5", destination("etsy"))).toBe(2000);
    expect(destinationTargetPx("9:16", destination("amazon"))).toBe(1600);
    expect(destinationTargetPx(undefined, { formats: [] })).toBe(2000);
  });

  it("runs at 2K only on a model that offers it, and on GPT Image 2 at an aspect it has a 2K size for", () => {
    const at = (provider: string, model: string, aspect = "4:5") =>
      sizeOn({ provider, model, size: "2k" }, aspect);
    expect(at("openai", "gpt-image-2")).toBe("2k");
    expect(at("openai", "gpt-image-2", "21:9")).toBe("1k");
    expect(at("openai", "gpt-image-1.5")).toBe("1k");
    expect(at("google", "gemini-nano-banana-2.1", "21:9")).toBe("2k");
    expect(at("google", "gemini-3.1-flash-lite-image")).toBe("1k");
    expect(sizeOn({ provider: "openai", model: "gpt-image-2" }, "1:1")).toBe(
      "1k",
    );
  });

  it("asks GPT Image 2 for each aspect exactly, long side 2048, sides multiples of 16", () => {
    for (const [aspect, { width, height }] of Object.entries(OPENAI_2K)) {
      const [a, b] = aspect.split(":").map(Number);
      expect(width * b, aspect).toBe(height * a);
      expect(Math.max(width, height), aspect).toBeLessThanOrEqual(2048);
      expect(width % 16, aspect).toBe(0);
      expect(height % 16, aspect).toBe(0);
    }
  });
});
