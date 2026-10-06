import { describe, expect, it } from "vitest";
import { modelPriced } from "@/domain/generation-cost";
import {
  assertModel,
  catalogFor,
  checkModel,
  DEFAULT_MAKER_MODELS,
  MODEL_CATALOG,
  ModelRefused,
  makerModels,
  modelLabel,
} from "@/domain/model-defaults";

describe("model catalog", () => {
  it("offers both providers for images and text, and Google for video", () => {
    for (const kind of ["image", "text"] as const) {
      const providers = new Set(catalogFor(kind).map((m) => m.provider));
      expect([...providers].sort()).toEqual(["google", "openai"]);
    }
    expect(catalogFor("video").every((m) => m.provider === "google")).toBe(
      true,
    );
  });

  it("keeps Sora only as a label: retired, never offered or run", () => {
    expect(catalogFor("video").some((m) => m.id.startsWith("sora"))).toBe(
      false,
    );
    expect(modelLabel({ provider: "openai", model: "sora-2" })).toBe(
      "Sora 2 (retired)",
    );
    const check = checkModel({ provider: "openai", model: "sora-2" }, "video");
    expect(check).toMatchObject({ ok: false, reason: "retired" });
    expect(check.ok ? "" : check.message).toMatch(
      /Sora 2 was shut down on 2026-09-24/,
    );
  });

  it("refuses a model it does not offer, or offered for another kind", () => {
    expect(
      checkModel({ provider: "google", model: "made-up" }, "image"),
    ).toMatchObject({ ok: false, reason: "unknown" });
    expect(
      checkModel({ provider: "google", model: "gemini-3.5-flash" }, "image"),
    ).toMatchObject({ ok: false, reason: "unknown" });
    expect(() =>
      assertModel({ provider: "openai", model: "gemini-3-pro-image" }, "image"),
    ).toThrow(ModelRefused);
  });

  it("marks the OpenAI images that retire on 2026-12-01", () => {
    const retiring = MODEL_CATALOG.filter((m) => m.retires === "2026-12-01");
    expect(retiring.map((m) => m.id).sort()).toEqual([
      "gpt-image-1-mini",
      "gpt-image-1.5",
    ]);
  });

  it("every model it offers has a pinned price (or the queue refuses it)", () => {
    for (const m of MODEL_CATALOG.filter((e) => !e.retired)) {
      const resolutions = m.seconds
        ? (Object.keys(m.seconds) as ("720p" | "1080p")[])
        : [undefined];
      for (const resolution of resolutions) {
        expect(
          modelPriced(
            { provider: m.provider, model: m.id, resolution },
            m.kind,
          ),
          `${m.provider}/${m.id} ${resolution ?? ""}`,
        ).toBe(true);
      }
      for (const quality of m.qualities ?? []) {
        expect(
          modelPriced({ provider: m.provider, model: m.id, quality }, m.kind),
        ).toBe(true);
      }
    }
  });

  it("each model id appears once per provider", () => {
    const keys = MODEL_CATALOG.map((m) => `${m.provider}/${m.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("maker defaults", () => {
  it("are images on gpt-image-2 medium, video on Veo 3.1 Fast 720p, text on gpt-6.1-sol", () => {
    expect(DEFAULT_MAKER_MODELS).toEqual({
      image: { provider: "openai", model: "gpt-image-2", quality: "medium" },
      video: {
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
        resolution: "720p",
      },
      text: { provider: "openai", model: "gpt-6.1-sol" },
    });
    for (const kind of ["image", "video", "text"] as const) {
      expect(checkModel(DEFAULT_MAKER_MODELS[kind], kind).ok).toBe(true);
    }
  });

  it("reads a saved value per kind, falling back per kind when missing, malformed or retired", () => {
    const saved = makerModels({
      image: { provider: "google", model: "gemini-3.1-flash-image" },
      video: { provider: "openai", model: "sora-2" },
      text: "nonsense",
    });
    expect(saved.image).toEqual({
      provider: "google",
      model: "gemini-3.1-flash-image",
    });
    expect(saved.video).toEqual(DEFAULT_MAKER_MODELS.video);
    expect(saved.text).toEqual(DEFAULT_MAKER_MODELS.text);
    expect(makerModels(null)).toEqual(DEFAULT_MAKER_MODELS);
  });
});
