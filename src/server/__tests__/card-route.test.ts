import { describe, expect, it, vi } from "vitest";
import { estimateGeneration } from "@/domain/generation-cost";
import type { ImageGenerationRequest } from "@/domain/generation-request";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { proposeRoutes } from "@/domain/model-routing";

// What a card reserves along its route: the models it may move to and the
// worst case, one charged call at most.

const keys = { openai: true, google: true };
vi.mock("@/providers/keys", () => ({
  hasProviderKey: (provider: "openai" | "google") => keys[provider],
}));
vi.mock("@/providers/mode", () => ({ providerMode: () => "live" }));

const { cardRoute } = await import("@/server/generation-queue");

const request: ImageGenerationRequest = {
  kind: "image",
  masterAssetUrl: "https://stub.local/plate.png",
  prompt: "a scene",
  imageInputs: [],
  negative: "",
  model: {
    provider: "openai",
    model: "gpt-image-2",
    quality: "medium",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  },
};
const PRO = { provider: "google" as const, model: "gemini-3-pro-image" };
const routes = proposeRoutes(DEFAULT_MAKER_MODELS, keys);
const max = (model: Parameters<typeof estimateGeneration>[0]) =>
  Math.round((estimateGeneration(model, "4:5")?.max ?? 0) * 1_000_000);

describe("cardRoute", () => {
  it("reserves the card's own max when its route does not fall back", () => {
    expect(cardRoute(request, routes)).toEqual({
      next: [],
      maxMicros: max(request.model),
    });
    expect(cardRoute(request, null).next).toEqual([]);
  });

  it("reserves the dearest model's max when it may move", () => {
    const on = {
      ...routes,
      final: { models: [routes.final.models[0], PRO], fallback: true },
    };
    expect(cardRoute(request, on)).toEqual({
      next: [PRO],
      maxMicros: Math.max(max(request.model), max(PRO)),
    });
  });

  it("leaves out a model whose provider has no key", () => {
    const on = {
      ...routes,
      final: { models: [routes.final.models[0], PRO], fallback: true },
    };
    keys.google = false;
    expect(cardRoute(request, on)).toEqual({
      next: [],
      maxMicros: max(request.model),
    });
    keys.google = true;
  });
});
