import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { proposeRoutes } from "@/domain/model-routing";

const saved: unknown[][] = [];
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/server/maker-repository", () => ({
  saveMakerRoutes: async (...args: unknown[]) => {
    saved.push(args);
  },
}));

const { saveMakerRoutesAction } = await import("@/app/actions/settings");

const routes = proposeRoutes(DEFAULT_MAKER_MODELS, {
  openai: true,
  google: true,
});
const astra = { provider: "openai", model: "gpt-6-astra" };

afterEach(() => {
  saved.length = 0;
});

describe("saveMakerRoutesAction", () => {
  it("saves the routes with their efforts and the agents' own", async () => {
    const agents = {
      etsy: { models: [astra], fallback: false, effort: "max" },
    };
    const input = {
      routes: { ...routes, fast: { ...routes.fast, effort: "high" } },
      agents,
    };
    expect(await saveMakerRoutesAction(input)).toEqual({});
    expect(saved).toEqual([[input.routes, agents]]);
  });

  it("refuses an agent Kiln lacks, an image model, and saves nothing", async () => {
    expect(
      await saveMakerRoutesAction({
        routes,
        agents: { helper: { models: [astra], fallback: false } },
      }),
    ).toEqual({ error: 'Kiln has no agent "helper".' });
    expect(
      await saveMakerRoutesAction({
        routes,
        agents: {
          scenes: {
            models: [{ provider: "openai", model: "gpt-image-2" }],
            fallback: false,
          },
        },
      }),
    ).toEqual({
      error:
        '"gpt-image-2" is not a text model Kiln offers — pick one in the model picker.',
    });
    expect(saved).toEqual([]);
  });
});
