import { describe, expect, it } from "vitest";
import { Card } from "@/domain/card";
import { getImageProvider, getVideoProvider } from "@/providers/registry";

function cardWith(provider: "google" | "openai"): Card {
  return Card.parse({
    id: "c1",
    parentId: null,
    masterAssetId: "m1",
    recipeId: "recipe-etsy-hero",
    type: "image",
    direction: "Clean background",
    fields: {
      subject: { value: "pitcher", source: "image", locked: true },
      materials: { value: "stoneware", source: "image", locked: true },
      scene: { value: "sweep", source: "recipe", locked: false },
      composition: { value: "centered", source: "recipe", locked: false },
      lighting: { value: "soft", source: "image", locked: true },
      mood: { value: "calm", source: "image", locked: true },
      palette: { value: "brand palette", source: "brand", locked: true },
    },
    model: { provider, model: "x" },
  });
}

describe("registry", () => {
  it("returns the matching image adapter by id", () => {
    expect(getImageProvider("google").id).toBe("google");
    expect(getImageProvider("openai").id).toBe("openai");
  });

  it("resolves the adapter from card.model.provider", () => {
    expect(getImageProvider(cardWith("openai")).id).toBe("openai");
    expect(getImageProvider(cardWith("google")).id).toBe("google");
  });

  it("exposes Veo for video; OpenAI has none since Sora shut down", () => {
    expect(getVideoProvider("google")?.id).toBe("google");
    expect(getVideoProvider("openai")).toBeUndefined();
  });
});
