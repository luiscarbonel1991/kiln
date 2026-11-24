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
const checkKeyById = vi.hoisted(() => vi.fn());
vi.mock("@/server/provider-health", () => ({ checkKey, checkKeyById }));
// The free check itself: never reached from these tests.
const checkProviderKey = vi.hoisted(() => vi.fn());
vi.mock("@/providers/key-check", () => ({ checkProviderKey }));

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
// The writes of a studio's keys: none may run for someone who is not the
// owner, nor in mock mode.
const writes = vi.hoisted(() => ({
  addProviderKey: vi.fn(async () => ({ id: "k-new" })),
  editProviderKey: vi.fn(async () => {}),
  replaceProviderKey: vi.fn(async () => {}),
  removeProviderKeyById: vi.fn(async () => {}),
}));
vi.mock("@/server/provider-keys", async (original) => ({
  ...(await original<typeof import("@/server/provider-keys")>()),
  saveProviderKey,
  removeProviderKey,
  ...writes,
}));
const mode = vi.hoisted(() => ({ current: "live" as "live" | "mock" }));
vi.mock("@/providers/mode", async (original) => ({
  ...(await original<typeof import("@/providers/mode")>()),
  providerMode: () => mode.current,
}));

const {
  addProviderKeyAction,
  checkProviderKeyAction,
  checkProviderKeyByIdAction,
  editProviderKeyAction,
  removeProviderKeyAction,
  removeProviderKeyByIdAction,
  replaceProviderKeyAction,
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
  mode.current = "live";
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

// A studio's several keys: adding one, changing its name or its people,
// replacing its secret, checking it and removing it are the owner's alone.
// What the client sends is only what the form holds: never who is asking.
describe("a key of the studio's, as someone who is not the owner", () => {
  const refusal = {
    name: "OwnerOnly",
    message: "Only the studio's owner can do that.",
  };
  const KEY = "sk-fixture-not-a-real-key-0000";
  const calls = [
    [
      "adding a key",
      () =>
        addProviderKeyAction({
          provider: "openai",
          name: "Bob's key",
          who: "people",
          memberIds: ["m1"],
          key: KEY,
        }),
    ],
    [
      "changing a key's name or people",
      () =>
        editProviderKeyAction({
          keyId: "k1",
          name: "Bob's key",
          who: "team",
          memberIds: [],
        }),
    ],
    [
      "replacing a key",
      () => replaceProviderKeyAction({ keyId: "k1", key: KEY }),
    ],
    ["checking a key", () => checkProviderKeyByIdAction({ keyId: "k1" })],
    ["removing a key", () => removeProviderKeyByIdAction({ keyId: "k1" })],
  ] as const;

  const nothingHappened = () => {
    for (const write of Object.values(writes)) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(saveProviderKey).not.toHaveBeenCalled();
    expect(removeProviderKey).not.toHaveBeenCalled();
    expect(checkKey).not.toHaveBeenCalled();
    expect(checkKeyById).not.toHaveBeenCalled();
    expect(checkProviderKey).not.toHaveBeenCalled();
  };

  for (const [what, call] of calls) {
    it(`${what} is refused: nothing is written and no provider is asked`, async () => {
      who.role = "member";
      await expect(call()).rejects.toMatchObject(refusal);
      nothingHappened();
    });
  }

  it("a member who says in the input that they are the owner is refused all the same", async () => {
    who.role = "member";
    await expect(
      addProviderKeyAction({
        provider: "openai",
        name: "Mine",
        who: "people",
        memberIds: ["m1"],
        key: KEY,
        role: "owner",
        member: { id: "m1", role: "owner" },
      }),
    ).rejects.toMatchObject(refusal);
    nothingHappened();
  });
});

describe("a key of the studio's, in mock mode", () => {
  it("adding or replacing a key is refused, as no provider is called, and nothing is written", async () => {
    mode.current = "mock";
    const KEY = "sk-fixture-not-a-real-key-0000";
    const words = {
      ok: false,
      message: "Mock mode calls no provider: add keys in a live run.",
    };
    expect(
      await addProviderKeyAction({
        provider: "openai",
        name: "Team key",
        who: "team",
        memberIds: [],
        key: KEY,
      }),
    ).toMatchObject(words);
    expect(
      await replaceProviderKeyAction({ keyId: "k1", key: KEY }),
    ).toMatchObject(words);
    expect(writes.addProviderKey).not.toHaveBeenCalled();
    expect(writes.replaceProviderKey).not.toHaveBeenCalled();
    expect(checkProviderKey).not.toHaveBeenCalled();
  });
});
