import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The keys of each studio are read once and kept per studio (its key rows,
// who each key is given to, and which of those people are on its team), and
// the key each caller runs on is picked per call from that one entry. So the
// cache can never hand one person's key to another, nor one studio's to
// another. The database is a fixture; the keys are sealed fixtures.

type KeyRow = {
  id: string;
  makerId: string;
  provider: string;
  name: string;
  forTeam: boolean;
  sealed: string;
  hint: string;
};
type AccessRow = {
  makerId: string;
  keyId: string;
  provider: string;
  memberId: string;
};

const rows = vi.hoisted(() => ({
  keys: [] as KeyRow[],
  access: [] as AccessRow[],
  // Which studio each person is on.
  people: [] as { id: string; makerId: string }[],
  failNext: false,
}));

// Reads only what a query names: the maker id must appear in it.
const names = (args: unknown, makerId: string) =>
  JSON.stringify(args ?? {}).includes(`"${makerId}"`);

const findKeys = vi.hoisted(() =>
  vi.fn(async (args: { where?: { makerId?: unknown } }) => {
    if (rows.failNext) {
      rows.failNext = false;
      throw new Error("the database blinked");
    }
    return rows.keys.filter((r) => args?.where?.makerId === r.makerId);
  }),
);
const findAccess = vi.hoisted(() =>
  vi.fn(async (args: { where?: { makerId?: unknown } }) =>
    rows.access.filter((r) => args?.where?.makerId === r.makerId),
  ),
);
const findPeople = vi.hoisted(() =>
  vi.fn(async (args: unknown) =>
    rows.people
      .filter((p) => names(args, p.makerId))
      .map((p) => ({
        id: p.id,
        organizationId: `org-${p.makerId}`,
        userId: `user-${p.id}`,
        role: "member",
      })),
  ),
);
vi.mock("@/lib/db", () => ({
  hasDatabase: () => true,
  assertDatabaseUrl: () => {},
  db: {
    providerKey: { findMany: findKeys },
    providerKeyAccess: { findMany: findAccess },
    member: { findMany: findPeople, findFirst: vi.fn(async () => null) },
  },
}));

const { providerKey, providerKeyId } = await import("@/providers/keys");
const { withMakerKeys } = await import("@/server/provider-keys");
const { seal } = await import("@/server/secret-box");

const key = (
  makerId: string,
  id: string,
  provider: "openai" | "google",
  forTeam: boolean,
): KeyRow => ({
  id,
  makerId,
  provider,
  name: id,
  forTeam,
  sealed: seal(`sk-${id}`, `provider-key:${provider}`),
  hint: id.slice(-4),
});

const bob = (makerId: string) => ({
  id: makerId,
  member: { id: `bob-${makerId}`, userId: "u-bob", role: "member" as const },
});
const carla = (makerId: string) => ({
  id: makerId,
  member: {
    id: `carla-${makerId}`,
    userId: "u-carla",
    role: "member" as const,
  },
});

const seen = (maker: Parameters<typeof withMakerKeys>[0]) =>
  withMakerKeys(maker, async () => [
    providerKey("openai") ?? null,
    providerKeyId("openai") ?? null,
  ]);

beforeAll(() => {
  for (const studio of ["studio-a", "studio-b"]) {
    rows.keys.push(
      key(studio, `${studio}-team`, "openai", true),
      key(studio, `${studio}-bob`, "openai", false),
    );
    rows.access.push({
      makerId: studio,
      keyId: `${studio}-bob`,
      provider: "openai",
      memberId: `bob-${studio}`,
    });
    rows.people.push(
      { id: `bob-${studio}`, makerId: studio },
      { id: `carla-${studio}`, makerId: studio },
    );
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the studio's keys, cached per studio and picked per call", () => {
  it("two people of one studio get their own keys from one read of the studio", async () => {
    const [bobs, carlas] = await Promise.all([
      seen(bob("studio-a")),
      seen(carla("studio-a")),
    ]);
    expect(bobs).toEqual(["sk-studio-a-bob", "studio-a-bob"]);
    expect(carlas).toEqual(["sk-studio-a-team", "studio-a-team"]);
    // And again, from the cache: still each their own.
    expect(await seen(carla("studio-a"))).toEqual(carlas);
    expect(await seen(bob("studio-a"))).toEqual(bobs);
    expect(findKeys).toHaveBeenCalledTimes(1);
  });

  it("a token of the studio runs on the team's key, from the same entry", async () => {
    expect(await seen({ id: "studio-a" })).toEqual([
      "sk-studio-a-team",
      "studio-a-team",
    ]);
    expect(findKeys).not.toHaveBeenCalled();
  });

  it("another studio's entry is its own, read with its own maker", async () => {
    expect(await seen(bob("studio-b"))).toEqual([
      "sk-studio-b-bob",
      "studio-b-bob",
    ]);
    expect(findKeys).toHaveBeenCalledTimes(1);
    expect(findKeys.mock.calls[0][0]).toMatchObject({
      where: { makerId: "studio-b" },
    });
    // Studio A's cached entry is untouched by B's read.
    expect(await seen(bob("studio-a"))).toEqual([
      "sk-studio-a-bob",
      "studio-a-bob",
    ]);
    expect(findKeys).toHaveBeenCalledTimes(1);
  });

  it("a person of one studio handed another studio's maker gets nothing given in either", async () => {
    // Studio A's Bob with studio B's maker: B's rows name B's Bob, not him.
    const crossed = { id: "studio-b", member: bob("studio-a").member };
    expect(await seen(crossed)).toEqual(["sk-studio-b-team", "studio-b-team"]);
  });

  it("a read that fails is not kept: the next piece of work reads again", async () => {
    rows.keys.push(key("studio-c", "studio-c-team", "openai", true));
    rows.failNext = true;
    await expect(seen({ id: "studio-c" })).rejects.toThrow(
      "the database blinked",
    );
    expect(await seen({ id: "studio-c" })).toEqual([
      "sk-studio-c-team",
      "studio-c-team",
    ]);
    expect(findKeys).toHaveBeenCalledTimes(2);
  });
});
