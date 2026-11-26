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

// The free check of one key, as the provider would answer it.
const checked = vi.hoisted(() => ({
  result: {
    ok: true,
    called: true,
    models: [],
    unlisted: [],
    provider: "openai",
  } as Record<string, unknown>,
}));
const checkKey = vi.hoisted(() => vi.fn());
vi.mock("@/server/provider-health", () => ({ checkKey }));
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
// The writes of a studio's keys: none may run for someone who is not the
// owner, nor in mock mode.
const writes = vi.hoisted(() => ({
  addProviderKey: vi.fn(async () => ({ id: "k-new" })),
  editProviderKey: vi.fn(async () => {}),
  replaceProviderKey: vi.fn(async () => {}),
  removeProviderKey: vi.fn(async () => {}),
}));
vi.mock("@/server/provider-keys", async (original) => ({
  ...(await original<typeof import("@/server/provider-keys")>()),
  ...writes,
}));
const mode = vi.hoisted(() => ({ current: "live" as "live" | "mock" }));
vi.mock("@/providers/mode", async (original) => ({
  ...(await original<typeof import("@/providers/mode")>()),
  providerMode: () => mode.current,
}));

const actions = await import("@/app/actions/settings");
const { KeyRefusal } = await import("@/server/provider-keys");
const {
  addProviderKeyAction,
  checkProviderKeyAction,
  editProviderKeyAction,
  removeProviderKeyAction,
  replaceProviderKeyAction,
  saveMakerRoutesAction,
} = actions;

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

describe("checking one key, as the owner", () => {
  it("names the offered models the provider no longer lists", async () => {
    checked.result = {
      ok: true,
      called: true,
      models: [],
      unlisted: [],
      provider: "google",
    };
    expect(await checkProviderKeyAction({ keyId: "k1" })).toEqual({
      ok: true,
      saved: false,
      message: "Google accepts the key.",
    });
    expect(checkKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test" }),
      "k1",
    );
    checked.result = {
      ok: true,
      called: true,
      models: [],
      unlisted: ["gemini-3-pro-image"],
      provider: "google",
    };
    expect(await checkProviderKeyAction({ keyId: "k1" })).toEqual({
      ok: true,
      saved: false,
      message:
        "Google accepts the key, but no longer lists Gemini 3 Pro Image: Kiln will not run it.",
    });
    checked.result = {
      ok: false,
      called: true,
      message: "rejected",
      provider: "google",
    };
    expect(await checkProviderKeyAction({ keyId: "k1" })).toMatchObject({
      ok: false,
      message: "rejected",
    });
  });
});

describe("a key of the studio's, as the owner", () => {
  it("an added key is kept for the studio, then checked for free", async () => {
    checked.result = {
      ok: true,
      called: true,
      models: [],
      unlisted: [],
      provider: "openai",
    };
    const input = {
      provider: "openai",
      name: "Team key",
      who: "team",
      memberIds: [],
      key: "sk-fixture-not-a-real-key-0000",
    };
    // The new key's id, so the answer shows on its row.
    expect(await addProviderKeyAction(input)).toEqual({
      ok: true,
      saved: true,
      message: "Saved. OpenAI accepts the key.",
      keyId: "k-new",
    });
    expect(writes.addProviderKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test" }),
      expect.objectContaining({
        provider: "openai",
        name: "Team key",
        who: "team",
        key: "sk-fixture-not-a-real-key-0000",
      }),
    );
    expect(checkKey).toHaveBeenCalledTimes(1);
    expect(checkKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test" }),
      "k-new",
    );
  });

  it("a key is removed for the studio, by its id", async () => {
    expect(await removeProviderKeyAction({ keyId: "k1" })).toEqual({
      ok: true,
      saved: false,
      message: "Removed.",
    });
    expect(writes.removeProviderKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test" }),
      "k1",
    );
  });

  // The form closes on `saved`: the key was written, even when the free
  // check right after it fails ("Saved, but: ..."); a refusal writes nothing
  // and keeps the form open.
  it("an answer says whether the key was written, whatever the check said after", async () => {
    const KEY = "sk-fixture-not-a-real-key-0000";
    const add = {
      provider: "openai",
      name: "Team key",
      who: "team",
      memberIds: [],
      key: KEY,
    };
    checked.result = {
      ok: false,
      called: true,
      message: "OpenAI rejected the API key.",
      provider: "openai",
    };
    expect(await addProviderKeyAction(add)).toEqual({
      ok: false,
      saved: true,
      message: "Saved, but: OpenAI rejected the API key.",
      keyId: "k-new",
    });
    expect(
      await replaceProviderKeyAction({ keyId: "k1", key: KEY }),
    ).toMatchObject({ ok: false, saved: true });
    checkKey.mockRejectedValueOnce(
      new KeyRefusal("That key was removed already."),
    );
    expect(await replaceProviderKeyAction({ keyId: "k1", key: KEY })).toEqual({
      ok: false,
      saved: true,
      message: "Saved, but: That key was removed already.",
    });
    expect(
      await editProviderKeyAction({
        keyId: "k1",
        name: "Bob's key",
        who: "team",
        memberIds: [],
      }),
    ).toEqual({ ok: true, saved: true, message: "Saved." });

    writes.addProviderKey.mockRejectedValueOnce(
      new KeyRefusal("Another OpenAI key has that name.", "name"),
    );
    expect(await addProviderKeyAction(add)).toEqual({
      ok: false,
      saved: false,
      message: "Another OpenAI key has that name.",
      field: "name",
    });
    expect(await addProviderKeyAction({ ...add, name: "" })).toMatchObject({
      ok: false,
      saved: false,
      field: "name",
    });
  });

  // Every key is managed by its id: no action is left that writes, checks
  // or removes "the provider's key" for the whole studio. The check and the
  // removal kept their names and take a key id; handed a provider, they
  // refuse and touch nothing.
  it("no action takes a provider in place of a key", async () => {
    expect(actions).not.toHaveProperty("saveProviderKeyAction");
    for (const action of [checkProviderKeyAction, removeProviderKeyAction]) {
      for (const input of [{ provider: "openai" }, "openai", {}]) {
        expect(await action(input)).toEqual({
          ok: false,
          saved: false,
          message: "Which key?",
        });
      }
    }
    for (const write of Object.values(writes)) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(checkKey).not.toHaveBeenCalled();
  });
});

// A failure that is not Kiln's own refusal (a database error, a person
// removed mid-save) reads as a fixed sentence; its detail goes to the
// server's log, with anything long enough to be a key masked.
describe("a key action that fails for a reason not Kiln's own", () => {
  const KEY = "sk-fixture-not-a-real-key-0000";
  const raw = Object.assign(
    new Error(
      `Foreign key constraint violated on ProviderKeyAccess_memberId_fkey, key ${KEY}`,
    ),
    { code: "P2003" },
  );

  it("the owner reads a fixed sentence, never the raw text, and the log holds no key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writes.addProviderKey.mockRejectedValueOnce(raw);
    writes.editProviderKey.mockRejectedValueOnce(raw);
    writes.replaceProviderKey.mockRejectedValueOnce(raw);
    writes.removeProviderKey.mockRejectedValueOnce(raw);
    const answers = [
      await addProviderKeyAction({
        provider: "openai",
        name: "Team key",
        who: "team",
        memberIds: [],
        key: KEY,
      }),
      await editProviderKeyAction({
        keyId: "k1",
        name: "Bob's key",
        who: "team",
        memberIds: [],
      }),
      await replaceProviderKeyAction({ keyId: "k1", key: KEY }),
      await removeProviderKeyAction({ keyId: "k1" }),
    ];
    expect(answers).toEqual([
      {
        ok: false,
        saved: false,
        message: "Kiln could not save the key; try again.",
      },
      {
        ok: false,
        saved: false,
        message: "Kiln could not save the change; try again.",
      },
      {
        ok: false,
        saved: false,
        message: "Kiln could not save the key; try again.",
      },
      {
        ok: false,
        saved: false,
        message: "Kiln could not remove the key; try again.",
      },
    ]);
    checkKey.mockRejectedValueOnce(raw);
    expect(await checkProviderKeyAction({ keyId: "k1" })).toEqual({
      ok: false,
      saved: false,
      message: "Kiln could not check the key; try again.",
    });
    expect(warn).toHaveBeenCalledTimes(5);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("P2003");
    expect(logged).not.toContain(KEY);
    warn.mockRestore();
  });

  // Masked first, then cut: a key across the log's 500th character leaves
  // no unmasked start behind.
  it("the log masks a key that the cut to 500 characters would split", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const long = new Error(`${"a ".repeat(243)}${KEY} after`);
    writes.removeProviderKey.mockRejectedValueOnce(long);
    await removeProviderKeyAction({ keyId: "k1" });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("[masked]");
    expect(logged).not.toContain(KEY.slice(0, 14));
    warn.mockRestore();
  });

  it("a key saved whose check then fails so reads as saved, in the fixed sentence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkKey.mockRejectedValueOnce(raw);
    expect(await replaceProviderKeyAction({ keyId: "k1", key: KEY })).toEqual({
      ok: false,
      saved: true,
      message: "Saved, but: Kiln could not check the key; try again.",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    warn.mockRestore();
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
    ["checking a key", () => checkProviderKeyAction({ keyId: "k1" })],
    ["removing a key", () => removeProviderKeyAction({ keyId: "k1" })],
  ] as const;

  const nothingHappened = () => {
    for (const write of Object.values(writes)) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(checkKey).not.toHaveBeenCalled();
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
