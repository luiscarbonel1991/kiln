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

const checked = vi.hoisted(() => ({
  result: { ok: true, called: true, models: [], unlisted: [] } as Record<
    string,
    unknown
  >,
}));
vi.mock("@/server/provider-health", () => ({
  checkKey: async () => checked.result,
}));

const { checkProviderKeyAction, saveMakerRoutesAction } = await import(
  "@/app/actions/settings"
);

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

describe("checkProviderKeyAction", () => {
  it("names the offered models the provider no longer lists", async () => {
    checked.result = { ok: true, called: true, models: [], unlisted: [] };
    expect(await checkProviderKeyAction("google")).toEqual({
      ok: true,
      message: "Google accepts the key.",
    });
    checked.result = {
      ok: true,
      called: true,
      models: [],
      unlisted: ["gemini-3-pro-image"],
    };
    expect(await checkProviderKeyAction("google")).toEqual({
      ok: true,
      message:
        "Google accepts the key, but no longer lists Gemini 3 Pro Image: Kiln will not run it.",
    });
    checked.result = { ok: false, called: true, message: "rejected" };
    expect(await checkProviderKeyAction("google")).toEqual({
      ok: false,
      message: "rejected",
    });
  });
});
