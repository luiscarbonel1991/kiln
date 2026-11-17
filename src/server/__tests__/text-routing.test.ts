import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { type MakerRoutes, proposeRoutes } from "@/domain/model-routing";
import type { ReviewField } from "@/providers/text-prompts";

// The text calls along their role's route: each attempt its own direct call
// (priced, reserved, recorded with the move that led to it), a failure moving
// on only as fallbackAfter allows.

const withStatus = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

let routes: MakerRoutes | null = null;
const keys = { openai: true, google: true };
const answers = new Map<string, unknown>();
const priced: {
  model: string;
  route?: unknown;
  estimateMax?: unknown;
  sessionId?: string;
}[] = [];
const sent: { model: string; effort?: string }[] = [];

vi.mock("@/server/maker-repository", () => ({
  getMakerModelSetup: async () => ({ models: DEFAULT_MAKER_MODELS, routes }),
}));
vi.mock("@/providers/keys", () => ({
  hasProviderKey: (provider: "openai" | "google") => keys[provider],
}));
vi.mock("@/providers/mode", () => ({ providerMode: () => "live" }));
vi.mock("@/server/direct-spend", async (original) => ({
  ...(await original<typeof import("@/server/direct-spend")>()),
  withDirectSpend: async (
    _maker: unknown,
    call: {
      model: string;
      route?: unknown;
      estimateMax?: unknown;
      sessionId?: string;
    },
    run: (beforeCall: () => Promise<void>) => Promise<unknown>,
  ) => {
    priced.push({
      model: call.model,
      route: call.route,
      estimateMax: call.estimateMax,
      sessionId: call.sessionId,
    });
    return run(async () => {});
  },
}));
vi.mock("@/providers/registry", () => {
  const director = (provider: string) => ({
    reviewProduct: async (
      _input: unknown,
      options: {
        model: string;
        effort?: string;
        beforeCall: () => Promise<void>;
      },
    ) => {
      sent.push({ model: options.model, effort: options.effort });
      await options.beforeCall();
      const answer = answers.get(`${provider}/${options.model}`);
      if (answer instanceof Error) throw answer;
      return {
        value: { suggestions: [], checks: [] },
        model: options.model,
        usage: { inputTextTokens: 10, inputImageTokens: 0, outputTokens: 10 },
      };
    },
  });
  return {
    getArtDirector: director,
    getVisionProvider: director,
  };
});

const { reviewProduct } = await import("@/server/text-calls");
const fields: ReviewField[] = [];

beforeEach(() => {
  routes = proposeRoutes(DEFAULT_MAKER_MODELS, { openai: true, google: true });
});

afterEach(() => {
  answers.clear();
  priced.length = 0;
  sent.length = 0;
  keys.openai = true;
  keys.google = true;
});

describe("text calls on a route", () => {
  it("runs the role's first model and says nothing more when it answers", async () => {
    const result = await reviewProduct({ id: "test" }, fields);
    expect(result).toMatchObject({ label: "GPT-6 Luna" });
    expect(result.ranOn).toBeUndefined();
    expect(priced.map((p) => p.model)).toEqual(["gpt-6-luna"]);
  });

  it("moves down the route after an answered failure, recording the move", async () => {
    answers.set("openai/gpt-6-luna", withStatus(503));
    const result = await reviewProduct({ id: "test" }, fields);
    expect(result.review).toBeDefined();
    expect(result.ranOn).toEqual({
      label: "Gemini 3.5 Flash-Lite",
      from: "GPT-6 Luna",
      reason: "OpenAI answered 503",
    });
    expect(priced.map((p) => p.model)).toEqual([
      "gpt-6-luna",
      "gemini-3.5-flash-lite",
    ]);
    expect(priced[0].route).toBeUndefined();
    expect(priced[1].route).toMatchObject({
      switched: [
        {
          from: { provider: "openai", model: "gpt-6-luna" },
          to: { provider: "google", model: "gemini-3.5-flash-lite" },
          reason: "OpenAI answered 503",
        },
      ],
    });
  });

  it("counts every attempt for the conversation whose tool asked", async () => {
    answers.set("openai/gpt-6-luna", withStatus(503));
    await reviewProduct({ id: "test" }, fields, undefined, { sessionId: "s1" });
    expect(priced.map((p) => p.sessionId)).toEqual(["s1", "s1"]);
  });

  it("keeps a call with no answer final: it may have been charged", async () => {
    answers.set("openai/gpt-6-luna", new Error("Request timed out"));
    const result = await reviewProduct({ id: "test" }, fields);
    expect(result.review).toBeUndefined();
    expect(result.degraded).toMatchObject({ model: "gpt-6-luna" });
    expect(priced).toHaveLength(1);
  });

  it("skips a model whose provider has no key", async () => {
    answers.set("openai/gpt-6-luna", withStatus(503));
    keys.google = false;
    const result = await reviewProduct({ id: "test" }, fields);
    expect(result.degraded).toMatchObject({
      model: "gpt-6-luna",
      // Not tried, so still offered on a click.
      alternative: { provider: "google" },
    });
    expect(priced).toHaveLength(1);
  });

  it("offers no other provider when every provider was tried", async () => {
    answers.set("openai/gpt-6-luna", withStatus(503));
    answers.set("google/gemini-3.5-flash-lite", withStatus(500));
    const result = await reviewProduct({ id: "test" }, fields);
    expect(result.degraded).toMatchObject({
      model: "gemini-3.5-flash-lite",
      alternative: null,
    });
    expect(priced).toHaveLength(2);
  });

  it("runs one model when the route does not fall back, or none was saved", async () => {
    answers.set("openai/gpt-6-luna", withStatus(503));
    if (!routes) throw new Error("no routes");
    routes = { ...routes, fast: { ...routes.fast, fallback: false } };
    expect(
      (await reviewProduct({ id: "test" }, fields)).degraded,
    ).toBeDefined();
    expect(priced).toHaveLength(1);

    priced.length = 0;
    routes = null;
    answers.set("openai/gpt-6.1-sol", withStatus(503));
    const result = await reviewProduct({ id: "test" }, fields);
    // Before routes, a call runs the default text model, as it always did.
    expect(result.degraded).toMatchObject({
      model: "gpt-6.1-sol",
      alternative: { provider: "google" },
    });
    expect(priced.map((p) => p.model)).toEqual(["gpt-6.1-sol"]);
  });

  it("runs a model asked for by name alone", async () => {
    answers.set("google/gemini-3.8-flash", withStatus(503));
    const result = await reviewProduct({ id: "test" }, fields, {
      provider: "google",
      model: "gemini-3.8-flash",
    });
    expect(result.degraded).toBeDefined();
    expect(priced.map((p) => p.model)).toEqual(["gemini-3.8-flash"]);
  });

  it("runs at its role's effort, a model asked for by name too, and reserves what it buys", async () => {
    if (!routes) throw new Error("no routes");
    routes = { ...routes, fast: { ...routes.fast, effort: "high" } };
    await reviewProduct({ id: "test" }, fields);
    await reviewProduct({ id: "test" }, fields, {
      provider: "openai",
      model: "gpt-6.1-sol",
    });
    expect(sent).toEqual([
      { model: "gpt-6-luna", effort: "high" },
      { model: "gpt-6.1-sol", effort: "high" },
    ]);
    // GPT-6 Luna: 3,000 in at $0.10 and 2,000 x 4 out at $0.50 per 1M.
    expect(priced[0].estimateMax).toBe(0.0043);
  });
});
