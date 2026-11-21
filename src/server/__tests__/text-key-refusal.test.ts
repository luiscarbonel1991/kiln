import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { type MakerRoutes, proposeRoutes } from "@/domain/model-routing";
import type { ReviewField } from "@/providers/text-prompts";

// A text call whose provider has no key in reach, with the real direct-spend
// under it: the call is refused when it is opened, so nothing is reserved for
// it; a saved route moves on to another provider's model and records the
// move, and with no route the answer says why in the reader's words. The
// ledger, the keys and the providers are fixtures: nothing is asked or paid.

let routes: MakerRoutes | null = null;
const keys = vi.hoisted(() => ({ openai: true, google: true }));
const sent: string[] = [];
const reserveDirectCall = vi.fn(
  async (_row: { model: string; route?: unknown }): Promise<string> => "row-1",
);
const markDirectCall = vi.fn(async () => {});
const closeDirectCall = vi.fn(async () => {});
const readUnlisted = vi.fn(async () => ({}));

vi.mock("@/lib/db", () => ({
  hasDatabase: () => true,
  // The studio's owner, whom a member is told to ask.
  db: {
    member: {
      findMany: async () => [{ role: "owner", user: { name: "Ana Ruiz" } }],
    },
  },
}));
vi.mock("@/providers/mode", () => ({ providerMode: () => "live" }));
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: (provider: "openai" | "google") => keys[provider],
}));
const { QueueRefusal } = vi.hoisted(() => ({
  QueueRefusal: class QueueRefusal extends Error {
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/generation-repository", () => ({
  QueueRefusal,
  reserveDirectCall,
  markDirectCall,
  closeDirectCall,
  readUnlisted,
}));
vi.mock("@/server/maker-repository", () => ({
  getMakerModelSetup: async () => ({ models: DEFAULT_MAKER_MODELS, routes }),
}));
vi.mock("@/providers/registry", () => {
  const director = () => ({
    reviewProduct: async (
      _input: unknown,
      options: { model: string; beforeCall: () => Promise<void> },
    ) => {
      sent.push(options.model);
      await options.beforeCall();
      return {
        value: { suggestions: [], checks: [] },
        model: options.model,
        usage: { inputTextTokens: 10, inputImageTokens: 0, outputTokens: 10 },
      };
    },
  });
  return { getArtDirector: director, getVisionProvider: director };
});

const { reviewProduct } = await import("@/server/text-calls");
const { withProviderKeys } = await import("@/providers/keys");
const fields: ReviewField[] = [];

const member = {
  id: "maker-1",
  member: { id: "m1", userId: "u1", role: "member" as const },
};
const owner = {
  id: "maker-1",
  member: { id: "o1", userId: "u0", role: "owner" as const },
};

beforeEach(() => {
  routes = proposeRoutes(DEFAULT_MAKER_MODELS, { openai: true, google: true });
  keys.openai = false;
});

afterEach(() => {
  sent.length = 0;
  keys.openai = true;
  keys.google = true;
  vi.clearAllMocks();
});

describe("a text call whose provider has no key in reach", () => {
  it("runs on the saved route's next model, reserving only that one and recording the move", async () => {
    for (const reader of [member, owner, { id: "maker-1" }]) {
      const result = await withProviderKeys({}, () =>
        reviewProduct(reader, fields),
      );
      expect(result.review).toBeDefined();
      expect(result.ranOn).toEqual({
        label: "Gemini 3.5 Flash-Lite",
        from: "GPT-6 Luna",
        reason: "OpenAI has no API key",
      });
      // The provider without a key was never asked.
      expect(sent).toEqual(["gemini-3.5-flash-lite"]);
      expect(reserveDirectCall).toHaveBeenCalledTimes(1);
      expect(reserveDirectCall.mock.calls[0][0]).toMatchObject({
        makerId: "maker-1",
        provider: "google",
        model: "gemini-3.5-flash-lite",
        route: {
          switched: [
            {
              from: { provider: "openai", model: "gpt-6-luna" },
              to: { provider: "google", model: "gemini-3.5-flash-lite" },
              reason: "OpenAI has no API key",
            },
          ],
        },
      });
      // One row, closed once, with nothing marked failed for the refusal.
      expect(closeDirectCall).toHaveBeenCalledTimes(1);
      expect(closeDirectCall).toHaveBeenCalledWith(
        "row-1",
        expect.not.objectContaining({ error: expect.anything() }),
      );
      sent.length = 0;
      vi.clearAllMocks();
    }
  });

  it("with no saved route a member reads whom to ask, and the other provider is offered on a click", async () => {
    routes = null;
    const result = await withProviderKeys({}, () =>
      reviewProduct(member, fields),
    );
    expect(result.review).toBeUndefined();
    expect(result.degraded).toMatchObject({
      provider: "openai",
      model: "gpt-6.1-sol",
      message: "You have no access to an OpenAI key; ask Ana.",
      alternative: { provider: "google" },
    });
    expect(sent).toEqual([]);
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(readUnlisted).not.toHaveBeenCalled();
  });

  it("with no saved route the owner and work with no person read where to add the key", async () => {
    routes = null;
    for (const reader of [owner, { id: "maker-1" }]) {
      const result = await withProviderKeys({}, () =>
        reviewProduct(reader, fields),
      );
      expect(result.degraded).toMatchObject({
        model: "gpt-6.1-sol",
        message: "OpenAI has no API key: add one in Settings → Providers.",
        alternative: { provider: "google" },
      });
      expect(sent).toEqual([]);
      expect(reserveDirectCall).not.toHaveBeenCalled();
    }
  });

  it("a route that does not fall back is refused where it stands, never moved on Kiln's own", async () => {
    if (!routes) throw new Error("no routes");
    routes = { ...routes, fast: { ...routes.fast, fallback: false } };
    const result = await withProviderKeys({}, () =>
      reviewProduct(member, fields),
    );
    expect(result.degraded).toMatchObject({
      model: "gpt-6-luna",
      message: "You have no access to an OpenAI key; ask Ana.",
    });
    expect(sent).toEqual([]);
    expect(reserveDirectCall).not.toHaveBeenCalled();
  });
});
