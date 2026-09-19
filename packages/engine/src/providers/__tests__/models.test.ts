import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_IDS,
  IMAGE_MODEL_CATALOG,
  VIDEO_MODEL_CATALOG,
} from "@/domain/model-defaults";
import { resolveImageModel, resolveVideoModel } from "@/providers/models";

describe("resolveImageModel", () => {
  it("passes through catalog models for the matching provider", () => {
    expect(resolveImageModel("google", "gemini-3-pro-image")).toBe(
      "gemini-3-pro-image",
    );
    expect(resolveImageModel("openai", "gpt-image-1.5")).toBe("gpt-image-1.5");
  });

  it("falls back to the provider default for unknown or cross-provider ids", () => {
    expect(resolveImageModel("google", "totally-made-up")).toBe(
      DEFAULT_MODEL_IDS.google.image,
    );
    expect(resolveImageModel("openai", "gemini-3-pro-image")).toBe(
      DEFAULT_MODEL_IDS.openai.image,
    );
    expect(resolveImageModel("google", undefined)).toBe(
      DEFAULT_MODEL_IDS.google.image,
    );
  });

  it("catalog ids are unique and both defaults are pickable", () => {
    const ids = IMAGE_MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_MODEL_IDS.google.image);
    expect(ids).toContain(DEFAULT_MODEL_IDS.openai.image);
  });
});

describe("resolveVideoModel", () => {
  it("passes through catalog models for the matching provider", () => {
    expect(resolveVideoModel("google", "veo-3.1-fast-generate-preview")).toBe(
      "veo-3.1-fast-generate-preview",
    );
    expect(resolveVideoModel("openai", "sora-2-pro")).toBe("sora-2-pro");
  });

  it("falls back to the provider default for unknown or cross-provider ids", () => {
    expect(resolveVideoModel("google", "sora-2")).toBe(
      DEFAULT_MODEL_IDS.google.video,
    );
    expect(resolveVideoModel("openai", "made-up-video-model")).toBe(
      DEFAULT_MODEL_IDS.openai.video,
    );
    expect(resolveVideoModel("openai", undefined)).toBe(
      DEFAULT_MODEL_IDS.openai.video,
    );
  });

  it("video catalog ids are unique and both defaults are pickable", () => {
    const ids = VIDEO_MODEL_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_MODEL_IDS.google.video);
    expect(ids).toContain(DEFAULT_MODEL_IDS.openai.video);
  });
});
