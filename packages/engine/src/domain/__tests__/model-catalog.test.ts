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
  unlistedModels,
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

  it("offers Gemini Omni Flash for video; Veo is shut down, refused with the date", () => {
    expect(catalogFor("video").map((m) => m.id)).toEqual([
      "gemini-omni-1.1-flash",
    ]);
    const check = checkModel(
      { provider: "google", model: "veo-3.1-fast-generate-preview" },
      "video",
    );
    expect(check).toMatchObject({ ok: false, reason: "retired" });
    expect(check.ok ? "" : check.message).toMatch(
      /Veo 3\.1 Fast was shut down on 2026-10-22/,
    );
    expect(
      modelLabel({ provider: "google", model: "veo-3.1-generate-preview" }),
    ).toBe("Veo 3.1 (retired)");
  });

  it("offers Nano Banana 2.1; Nano Banana 2 is deprecated, still offered and run", () => {
    const images = catalogFor("image");
    expect(images.some((m) => m.id === "gemini-nano-banana-2.1")).toBe(true);
    const nb2 = images.find((m) => m.id === "gemini-3.1-flash-image");
    expect(nb2?.deprecated).toBe("2026-10-06");
    expect(
      checkModel(
        { provider: "google", model: "gemini-3.1-flash-image" },
        "image",
      ),
    ).toMatchObject({ ok: true });
    expect(
      modelLabel({ provider: "google", model: "gemini-3.1-flash-image" }),
    ).toBe("Gemini 3.1 Flash Image");
  });

  it("names the offered models a provider's list no longer has; retired always wins", () => {
    const google = catalogFor("video")
      .concat(catalogFor("image"), catalogFor("text"))
      .filter((m) => m.provider === "google")
      .map((m) => m.id);
    const listed = google.filter((id) => id !== "gemini-3.1-flash-lite-image");
    // Veo is retired: not offered, so never named, though Google lists none.
    expect(unlistedModels("google", listed)).toEqual([
      "gemini-3.1-flash-lite-image",
    ]);
    expect(unlistedModels("google", [])).toEqual([]);
    // OpenAI still lists Sora 2; it stays refused.
    expect(unlistedModels("openai", ["sora-2"])).not.toContain("sora-2");
    expect(
      checkModel({ provider: "openai", model: "sora-2" }, "video").ok,
    ).toBe(false);
  });

  it("offers each provider's most capable text model, verified 2026-10-31", () => {
    const text = catalogFor("text").map((m) => m.id);
    expect(text).toEqual([
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6.1-terra",
      "gpt-6-luna",
      "gemini-3.8-flash",
      "gemini-4-argon",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("refuses Gemini 3.5 Flash and names what Google answers it with", () => {
    expect(modelLabel({ provider: "google", model: "gemini-3.5-flash" })).toBe(
      "Gemini 3.5 Flash (retired)",
    );
    const check = checkModel(
      { provider: "google", model: "gemini-3.5-flash" },
      "text",
    );
    expect(check.ok ? "" : check.message).toBe(
      "Gemini 3.5 Flash was retired on 2026-10-08: Google answers it with Gemini 3.6 Flash — pick that or another text model.",
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
  it("are images on gpt-image-2 medium, video on Gemini Omni Flash 720p, text on gpt-6.1-sol", () => {
    expect(DEFAULT_MAKER_MODELS).toEqual({
      image: { provider: "openai", model: "gpt-image-2", quality: "medium" },
      video: {
        provider: "google",
        model: "gemini-omni-1.1-flash",
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
