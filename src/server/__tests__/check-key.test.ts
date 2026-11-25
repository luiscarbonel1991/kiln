import { describe, expect, it, onTestFinished, vi } from "vitest";
import { catalogFor } from "@/domain/model-defaults";

// Checking a key compares the models the provider lists with the catalog.
// The fake check records which keys it was run with; no request goes out.
const listed = vi.hoisted(() => ({
  models: [] as string[],
  seen: [] as { keys: unknown; id: unknown }[],
}));
vi.mock("@/providers/key-check", async () => {
  const keys = await import("@/providers/keys");
  return {
    checkProviderKey: async (provider: "openai" | "google") => {
      listed.seen.push({
        keys: keys.currentProviderKeys(),
        id: (keys as Record<string, unknown>).providerKeyId
          ? (keys.providerKeyId as (p: string) => unknown)(provider)
          : undefined,
      });
      return { ok: true, called: true, models: listed.models };
    },
  };
});
// Two studios' key rows, as the database would hand them to their own maker.
const rows = vi.hoisted(() => ({
  keys: [] as Record<string, unknown>[],
  access: [] as Record<string, unknown>[],
}));
const store = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/db", () => ({
  hasDatabase: () => store.on,
  assertDatabaseUrl: () => {},
  db: {
    providerKey: {
      findMany: async (args: { where?: { makerId?: unknown } }) =>
        rows.keys.filter((r) => r.makerId === args?.where?.makerId),
      findFirst: async (args: {
        where?: { id?: unknown; makerId?: unknown };
      }) =>
        rows.keys.find(
          (r) => r.id === args?.where?.id && r.makerId === args?.where?.makerId,
        ) ?? null,
    },
    providerKeyAccess: {
      findMany: async (args: { where?: { makerId?: unknown } }) =>
        rows.access.filter((r) => r.makerId === args?.where?.makerId),
    },
    member: {
      findMany: async (args: unknown) =>
        JSON.stringify(args).includes('"studio-a"')
          ? [
              {
                id: "bob",
                organizationId: "org-a",
                userId: "u-bob",
                role: "member",
              },
            ]
          : [],
    },
  },
}));
const recordKeyCheck = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/generation-repository", async (original) => ({
  ...(await original<typeof import("@/server/generation-repository")>()),
  recordKeyCheck,
}));

const { checkKeyById } = await import("@/server/provider-health");
const { seal } = await import("@/server/secret-box");

const offered = (provider: "openai" | "google") =>
  (["image", "video", "text"] as const)
    .flatMap((kind) => catalogFor(kind))
    .filter((m) => m.provider === provider)
    .map((m) => m.id);

// One key of the studio is checked for free on its own, whoever it is
// given to, and the answer is kept on that key.
describe("checking one key", () => {
  const key = (makerId: string, id: string, forTeam: boolean) => ({
    id,
    makerId,
    provider: "openai",
    name: id,
    forTeam,
    sealed: seal(`sk-fixture-${id}`, "provider-key:openai"),
    hint: id.slice(-4),
  });
  const ana = {
    id: "studio-a",
    member: { id: "ana", userId: "u-ana", role: "owner" as const },
  };

  const on = () => {
    store.on = true;
    listed.seen.length = 0;
    recordKeyCheck.mockClear();
    onTestFinished(() => {
      store.on = false;
      listed.seen.length = 0;
      recordKeyCheck.mockClear();
    });
  };

  rows.keys.push(
    key("studio-a", "a-team", true),
    key("studio-a", "a-bob", false),
    {
      ...key("studio-a", "a-google", true),
      provider: "google",
      sealed: seal("sk-fixture-a-google", "provider-key:google"),
    },
    key("studio-b", "b-team", true),
  );
  rows.access.push({
    makerId: "studio-a",
    keyId: "a-bob",
    provider: "openai",
    memberId: "bob",
  });

  it("runs with that key and no other, and records the answer on it", async () => {
    on();
    listed.models = offered("openai");
    // The owner's own calls run on the team key; Bob's key is checked all
    // the same.
    expect(await checkKeyById(ana, "a-bob")).toMatchObject({ ok: true });
    expect(listed.seen).toEqual([
      { keys: { openai: "sk-fixture-a-bob" }, id: "a-bob" },
    ]);
    expect(recordKeyCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({
        makerId: "studio-a",
        provider: "openai",
        providerKeyId: "a-bob",
        memberId: "ana",
      }),
    );
  });

  it("a key of another studio is refused before any request, and nothing is recorded", async () => {
    on();
    await expect(checkKeyById(ana, "b-team")).rejects.toThrow(
      "That key was removed already.",
    );
    expect(listed.seen).toEqual([]);
    expect(recordKeyCheck).not.toHaveBeenCalled();
  });

  it("names the offered models the provider no longer lists", async () => {
    on();
    listed.models = offered("google").filter(
      (id) => id !== "gemini-omni-1.1-flash",
    );
    expect(await checkKeyById(ana, "a-google")).toMatchObject({
      ok: true,
      provider: "google",
      unlisted: ["gemini-omni-1.1-flash"],
    });
    listed.models = offered("google");
    expect(await checkKeyById(ana, "a-google")).toMatchObject({
      unlisted: [],
    });
  });

  // The check is recorded in the name of the person who ran it, or no one's.
  it("records the check with the person who ran it, or none", async () => {
    on();
    listed.models = offered("openai");
    await checkKeyById(ana, "a-team");
    expect(recordKeyCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ makerId: "studio-a", memberId: "ana" }),
    );
    await checkKeyById({ id: "studio-a" }, "a-team");
    expect(recordKeyCheck).toHaveBeenLastCalledWith(
      expect.objectContaining({ makerId: "studio-a", memberId: null }),
    );
  });
});
