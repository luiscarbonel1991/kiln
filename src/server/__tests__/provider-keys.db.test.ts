import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Against a migrated throwaway Postgres (see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("provider keys (database)", async () => {
  const stamp = Date.now();
  const { db } = await import("@/lib/db");
  const { providerKey } = await import("@/providers/keys");
  const {
    addProviderKey,
    listProviderKeys,
    removeProviderKeyById,
    replaceProviderKey,
    withMakerKeys,
  } = await import("@/server/provider-keys");

  let a: { id: string };
  let b: { id: string };

  beforeAll(async () => {
    a = await db.maker.create({ data: { slug: `keys-a-${stamp}`, name: "A" } });
    b = await db.maker.create({ data: { slug: `keys-b-${stamp}`, name: "B" } });
  });

  afterAll(async () => {
    await db.maker.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  const teamKey = (
    maker: { id: string },
    provider: "openai" | "google",
    key: string,
  ) =>
    addProviderKey(maker, {
      provider,
      name: "Team key",
      who: "team",
      memberIds: [],
      key,
    });
  const teamKeyOf = (maker: { id: string }) =>
    db.providerKey.findFirstOrThrow({
      where: { makerId: maker.id, provider: "openai", forTeam: true },
    });

  it("keeps a key sealed, hands it to its maker's work, and names only its last four", async () => {
    await teamKey(a, "openai", "  sk-test-abcdefghijklmnop1234  ");
    const row = await teamKeyOf(a);
    expect(row.sealed).not.toContain("abcdefghijklmnop");
    expect(row.sealed.startsWith("v1.")).toBe(true);
    expect(row.hint).toBe("1234");
    expect(await withMakerKeys(a, async () => providerKey("openai"))).toBe(
      "sk-test-abcdefghijklmnop1234",
    );
    const listed = await listProviderKeys(a);
    expect(listed.find((k) => k.provider === "openai")).toMatchObject({
      name: "Team key",
      forTeam: true,
      hint: "1234",
      readable: true,
    });
    expect(JSON.stringify(listed)).not.toContain("abcdefghijklmnop");
  });

  it("a key added for the whole team is the studio's team key, named, and its secret unseals", async () => {
    const row = await teamKeyOf(a);
    expect(row).toMatchObject({ name: "Team key", forTeam: true });
    expect(typeof row.id).toBe("string");
    expect(row.id.length).toBeGreaterThan(0);
    expect(await withMakerKeys(a, async () => providerKey("openai"))).toBe(
      "sk-test-abcdefghijklmnop1234",
    );
  });

  it("another maker on the same instance never sees that key", async () => {
    await teamKey(b, "openai", "sk-test-bbbbbbbbbbbbbbbb5678");
    const [seenByA, seenByB] = await Promise.all([
      withMakerKeys(a, async () => providerKey("openai")),
      withMakerKeys(b, async () => providerKey("openai")),
    ]);
    expect(seenByA).toBe("sk-test-abcdefghijklmnop1234");
    expect(seenByB).toBe("sk-test-bbbbbbbbbbbbbbbb5678");
    const listedB = await listProviderKeys(b);
    expect(listedB.map((k) => k.hint)).toEqual(["5678"]);
  });

  it("a replaced key is used from the next piece of work", async () => {
    await withMakerKeys(a, async () => providerKey("openai"));
    const { id } = await teamKeyOf(a);
    await replaceProviderKey(a, {
      keyId: id,
      key: "sk-test-replacedreplaced9999",
    });
    expect(await withMakerKeys(a, async () => providerKey("openai"))).toBe(
      "sk-test-replacedreplaced9999",
    );
  });

  it("replacing the team key keeps its one row and its id", async () => {
    const before = await db.providerKey.findMany({
      where: { makerId: a.id, provider: "openai" },
    });
    expect(before).toHaveLength(1);
    await replaceProviderKey(a, {
      keyId: before[0].id,
      key: "sk-test-againagainagain7777",
    });
    const after = await db.providerKey.findMany({
      where: { makerId: a.id, provider: "openai" },
    });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before[0].id,
      name: "Team key",
      forTeam: true,
      hint: "7777",
    });
  });

  it("refuses what cannot be a key, and removing one leaves no row", async () => {
    await expect(teamKey(a, "google", "short")).rejects.toThrow(/too short/);
    await expect(
      teamKey(a, "google", "two words that are long enough"),
    ).rejects.toThrow(/no spaces/);
    const { id } = await teamKeyOf(a);
    await removeProviderKeyById(a, id);
    expect(
      await withMakerKeys(a, async () => providerKey("openai")),
    ).toBeUndefined();
    expect(await db.providerKey.count({ where: { makerId: a.id } })).toBe(0);
    expect(await db.providerKey.count({ where: { makerId: b.id } })).toBe(1);
  });
});

// Several keys per provider: each caller's work runs on the key the lookup
// gives them, read only from their own studio's rows, and a person's key
// counts only inside the studio whose team they are on. Two studios, each
// with Ana (owner), Bob and Carla.
describe.skipIf(!enabled)(
  "the keys a caller's work runs on (database)",
  async () => {
    const { providerKey, providerKeyId } = await import("@/providers/keys");
    const keys = await import("@/server/provider-keys");
    const { closeStudio, openStudio, writeKey } = await import(
      "@/server/__tests__/fixtures/studio-keys"
    );
    type Studio = Awaited<ReturnType<typeof openStudio>>;
    type Ref = Parameters<typeof keys.withMakerKeys>[0];

    let a: Studio;
    let b: Studio;
    const ids: Record<string, string> = {};

    const SECRETS = {
      aTeam: "sk-fixture-a-team-00000000aaa1",
      aBob: "sk-fixture-a-bob-000000000aab2",
      aBobGoogle: "AIza-fixture-a-bob-0000000ag3",
      bTeam: "sk-fixture-b-team-00000000bbb4",
      bBob: "sk-fixture-b-bob-000000000bbb5",
      bForged: "sk-fixture-b-forged-000000bf6",
    };

    beforeAll(async () => {
      a = await openStudio("pick-a");
      b = await openStudio("pick-b");
      ids.aTeam = await writeKey(a, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: SECRETS.aTeam,
      });
      ids.aBob = await writeKey(a, {
        provider: "openai",
        name: "Bob's key",
        secret: SECRETS.aBob,
        people: [a.bob],
      });
      ids.aBobGoogle = await writeKey(a, {
        provider: "google",
        name: "Bob's key",
        secret: SECRETS.aBobGoogle,
        people: [a.bob],
      });
      ids.bTeam = await writeKey(b, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: SECRETS.bTeam,
      });
      ids.bBob = await writeKey(b, {
        provider: "openai",
        name: "Bob's key",
        secret: SECRETS.bBob,
        people: [b.bob],
      });
      // A key of B's whose access row names studio A's Bob: a person who is
      // not on B's team. The database allows the row; the lookup must not.
      ids.bForged = await writeKey(b, {
        provider: "openai",
        name: "Someone else's key",
        secret: SECRETS.bForged,
        people: [a.bob],
      });
    });

    afterAll(async () => {
      await closeStudio(a);
      await closeStudio(b);
    });

    const seen = (maker: Ref) =>
      keys.withMakerKeys(maker, async () => ({
        openai: providerKey("openai"),
        google: providerKey("google"),
        openaiId: providerKeyId("openai"),
        googleId: providerKeyId("google"),
      }));

    it("a person runs on the key given to them, everyone else on the team's", async () => {
      expect(await seen(a.as(a.bob))).toEqual({
        openai: SECRETS.aBob,
        google: SECRETS.aBobGoogle,
        openaiId: ids.aBob,
        googleId: ids.aBobGoogle,
      });
      for (const other of [a.as(a.carla), a.as(a.ana)]) {
        expect(await seen(other)).toEqual({
          openai: SECRETS.aTeam,
          google: undefined,
          openaiId: ids.aTeam,
          googleId: undefined,
        });
      }
    });

    it("a token runs on the team's key only, never a person's", async () => {
      expect(await seen(a.as())).toEqual({
        openai: SECRETS.aTeam,
        google: undefined,
        openaiId: ids.aTeam,
        googleId: undefined,
      });
    });

    it("each studio reads only its own rows", async () => {
      expect((await seen(b.as(b.bob))).openai).toBe(SECRETS.bBob);
      expect((await seen(b.as(b.carla))).openai).toBe(SECRETS.bTeam);
      const everyone = await Promise.all(
        [a.as(a.ana), a.as(a.bob), a.as(a.carla), a.as()].map(seen),
      );
      const text = JSON.stringify(everyone);
      for (const secret of [SECRETS.bTeam, SECRETS.bBob, SECRETS.bForged]) {
        expect(text).not.toContain(secret);
      }
    });

    it("a person of one studio handed another studio's maker gets none of either's given keys", async () => {
      // Studio A's Bob, with studio B's maker: B's access row naming him does
      // not count (he is not on B's team), and nothing of A's is read.
      const crossed: Ref = { id: b.makerId, member: a.as(a.bob).member };
      const read = await seen(crossed);
      expect(read.openai).toBe(SECRETS.bTeam);
      expect(read.openaiId).toBe(ids.bTeam);
      const text = JSON.stringify(read);
      for (const secret of [
        SECRETS.aTeam,
        SECRETS.aBob,
        SECRETS.aBobGoogle,
        SECRETS.bBob,
        SECRETS.bForged,
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it("the reach says whose key a caller runs on, and carries no id, name or last four", async () => {
      const carla = await keys.providerReach(a.as(a.carla));
      expect(carla.google).toMatchObject({ reach: "not-yours" });
      expect(carla.openai).toMatchObject({ reach: "in-reach", whose: "team" });
      const bob = await keys.providerReach(a.as(a.bob));
      expect(bob.openai).toMatchObject({ reach: "in-reach", whose: "given" });
      expect(bob.google).toMatchObject({ reach: "in-reach", whose: "given" });
      const text = JSON.stringify([carla, bob]);
      for (const id of Object.values(ids)) expect(text).not.toContain(id);
      for (const secret of Object.values(SECRETS)) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain(secret.slice(-4));
      }
      expect(text).not.toMatch(/Team key|Bob's key/);
    });
  },
);
