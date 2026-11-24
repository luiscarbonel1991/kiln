import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import { proposeRoutes } from "@/domain/model-routing";

const saved: unknown[][] = [];
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/server/maker-repository", () => ({
  saveMakerRoutes: async (_maker: unknown, ...args: unknown[]) => {
    saved.push(args);
  },
}));

const checked = vi.hoisted(() => ({
  result: { ok: true, called: true, models: [], unlisted: [] } as Record<
    string,
    unknown
  >,
}));
const checkKey = vi.hoisted(() => vi.fn());
vi.mock("@/server/provider-health", () => ({ checkKey }));

// Who is signed in: the studio's owner, or someone who works with them.
const who = vi.hoisted(() => ({ role: "owner" as "owner" | "member" }));
vi.mock("@/server/session", () => ({
  requireMaker: async () => ({
    id: "test",
    slug: "test",
    name: "Test",
    member: { id: "m1", userId: "u1", role: who.role },
  }),
  denyWithoutSession: async () => null,
}));
const saveProviderKey = vi.hoisted(() => vi.fn(async () => {}));
const removeProviderKey = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/provider-keys", async (original) => ({
  ...(await original<typeof import("@/server/provider-keys")>()),
  saveProviderKey,
  removeProviderKey,
}));
vi.mock("@/providers/mode", async (original) => ({
  ...(await original<typeof import("@/providers/mode")>()),
  providerMode: () => "live",
}));

const {
  checkProviderKeyAction,
  removeProviderKeyAction,
  saveMakerRoutesAction,
  saveProviderKeyAction,
} = await import("@/app/actions/settings");

const routes = proposeRoutes(DEFAULT_MAKER_MODELS, {
  openai: true,
  google: true,
});
const astra = { provider: "openai", model: "gpt-6-astra" };

beforeEach(() => {
  checkKey.mockImplementation(async () => checked.result);
});

afterEach(() => {
  saved.length = 0;
  who.role = "owner";
  vi.clearAllMocks();
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

// The keys are the owner's to manage: someone who works in the studio can
// neither check, save nor remove one, and nothing is asked or written.
describe("a provider's key, as someone who is not the owner", () => {
  const refusal = {
    name: "OwnerOnly",
    message: "Only the studio's owner can do that.",
  };

  it("checking a key is refused, and the provider is never asked", async () => {
    who.role = "member";
    await expect(checkProviderKeyAction("openai")).rejects.toMatchObject(
      refusal,
    );
    await expect(checkProviderKeyAction("google")).rejects.toMatchObject(
      refusal,
    );
    expect(checkKey).not.toHaveBeenCalled();
  });

  it("saving a key is refused: nothing is written and nothing is checked", async () => {
    who.role = "member";
    await expect(
      saveProviderKeyAction({ provider: "openai", key: "sk-fixture-0000" }),
    ).rejects.toMatchObject(refusal);
    expect(saveProviderKey).not.toHaveBeenCalled();
    expect(checkKey).not.toHaveBeenCalled();
  });

  it("removing a key is refused and nothing is removed", async () => {
    who.role = "member";
    await expect(removeProviderKeyAction("openai")).rejects.toMatchObject(
      refusal,
    );
    expect(removeProviderKey).not.toHaveBeenCalled();
  });
});

describe("a provider's key, as the owner", () => {
  it("a saved key is kept for the studio, then checked for free", async () => {
    checked.result = { ok: true, called: true, models: [], unlisted: [] };
    expect(
      await saveProviderKeyAction({
        provider: "openai",
        key: "sk-fixture-0000",
      }),
    ).toEqual({ ok: true, message: "Saved. OpenAI accepts the key." });
    expect(saveProviderKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test" }),
      "openai",
      "sk-fixture-0000",
    );
    expect(checkKey).toHaveBeenCalledTimes(1);
  });

  it("a key is removed for the studio", async () => {
    expect(await removeProviderKeyAction("google")).toEqual({
      ok: true,
      message: "Removed.",
    });
    expect(removeProviderKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test" }),
      "google",
    );
  });
});
