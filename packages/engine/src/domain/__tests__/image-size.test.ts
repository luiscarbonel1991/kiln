import { describe, expect, it } from "vitest";
import { requestModelLabel } from "@/domain/generation-request";
import {
  destinationImageSize,
  destinationTargetPx,
  OPENAI_1K,
  OPENAI_2K,
  openaiSize,
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

  it("sends GPT Image 2 each aspect exactly at 1K too; the other GPT models the nearest standard size", () => {
    const gpt2 = { provider: "openai", model: "gpt-image-2" };
    expect(openaiSize(gpt2, "4:5")).toBe("1024x1280");
    expect(openaiSize(gpt2, "9:16")).toBe("1008x1792");
    expect(openaiSize(gpt2, "1:1")).toBe("1024x1024");
    expect(openaiSize(gpt2, "2:3")).toBe("1024x1536");
    expect(openaiSize({ ...gpt2, size: "2k" }, "4:5")).toBe("1600x2000");
    const older = { provider: "openai", model: "gpt-image-1.5" };
    expect(openaiSize(older, "4:5")).toBe("1024x1536");
    expect(openaiSize(older, "16:9")).toBe("1536x1024");
    for (const [aspect, { width, height }] of Object.entries(OPENAI_1K)) {
      const [a, b] = aspect.split(":").map(Number);
      expect(width * b, aspect).toBe(height * a);
      expect(Math.min(width, height), aspect).toBeGreaterThanOrEqual(1008);
      expect((width % 16) + (height % 16), aspect).toBe(0);
      expect(width * height, aspect).toBeGreaterThanOrEqual(655_360);
    }
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

describe("a request's model, as the maker reads it", () => {
  it("says 2K when the request runs at 2K", () => {
    const image = (model: string, size?: "2k") => ({
      kind: "image" as const,
      masterAssetUrl: "https://stub.local/p.png",
      prompt: "",
      imageInputs: [],
      negative: "",
      model: {
        provider: "openai" as const,
        model,
        aspect: "1:1",
        guidance: 7.5,
        strength: 0.65,
        size,
      },
    });
    expect(requestModelLabel(image("gpt-image-2", "2k"))).toBe(
      "GPT Image 2 medium 2K",
    );
    expect(requestModelLabel(image("gpt-image-2"))).toBe("GPT Image 2 medium");
    expect(requestModelLabel(image("gpt-image-1.5", "2k"))).toBe(
      "GPT Image 1.5 medium",
    );
  });
});
