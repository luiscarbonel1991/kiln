import { describe, expect, it } from "vitest";
import { generationCatalog, generationModel } from "@/domain/model-defaults";

describe("generation policy: OpenAI only", () => {
  const card = {
    provider: "google" as const,
    model: "gemini-3.1-flash-image",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  };

  it("moves a Google image model to the OpenAI image default, keeping the rest", () => {
    expect(generationModel(card, "image")).toEqual({
      ...card,
      provider: "openai",
      model: "gpt-image-2",
    });
  });

  it("moves a Google video model to the OpenAI video default", () => {
    expect(
      generationModel({ ...card, model: "veo-3.1-generate-preview" }, "video"),
    ).toMatchObject({ provider: "openai", model: "sora-2" });
  });

  it("leaves an OpenAI model the maker picked untouched", () => {
    const picked = {
      ...card,
      provider: "openai" as const,
      model: "gpt-image-1.5",
    };
    expect(generationModel(picked, "image")).toBe(picked);
  });

  it("the pickers list OpenAI models only", () => {
    for (const kind of ["image", "video"] as const) {
      const catalog = generationCatalog(kind);
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.every((m) => m.provider === "openai")).toBe(true);
    }
  });
});
