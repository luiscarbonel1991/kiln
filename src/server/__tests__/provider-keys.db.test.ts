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
    providerKeyStates,
    removeProviderKey,
    saveProviderKey,
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

  it("keeps a key sealed, hands it to its maker's work, and names only its last four", async () => {
    await saveProviderKey(a.id, "openai", "  sk-test-abcdefghijklmnop1234  ");
    const row = await db.providerKey.findFirstOrThrow({
      where: { makerId: a.id, provider: "openai" },
    });
    expect(row.sealed).not.toContain("abcdefghijklmnop");
    expect(row.sealed.startsWith("v1.")).toBe(true);
    expect(row.hint).toBe("1234");
    expect(await withMakerKeys(a.id, async () => providerKey("openai"))).toBe(
      "sk-test-abcdefghijklmnop1234",
    );
    const states = await providerKeyStates(a.id);
    expect(states.find((s) => s.provider === "openai")).toEqual({
      provider: "openai",
      source: "saved",
      hint: "1234",
      unreadable: false,
      inEnvironment: false,
    });
  });

  it("a key saved from today's form is the studio's team key, named, and its secret unseals", async () => {
    const row = await db.providerKey.findFirstOrThrow({
      where: { makerId: a.id, provider: "openai" },
    });
    expect(row).toMatchObject({ name: "Team key", forTeam: true });
    expect(typeof row.id).toBe("string");
    expect(row.id.length).toBeGreaterThan(0);
    expect(await withMakerKeys(a.id, async () => providerKey("openai"))).toBe(
      "sk-test-abcdefghijklmnop1234",
    );
  });

  it("another maker on the same instance never sees that key", async () => {
    await saveProviderKey(b.id, "openai", "sk-test-bbbbbbbbbbbbbbbb5678");
    const [seenByA, seenByB] = await Promise.all([
      withMakerKeys(a.id, async () => providerKey("openai")),
      withMakerKeys(b.id, async () => providerKey("openai")),
    ]);
    expect(seenByA).toBe("sk-test-abcdefghijklmnop1234");
    expect(seenByB).toBe("sk-test-bbbbbbbbbbbbbbbb5678");
    const statesB = await providerKeyStates(b.id);
    expect(statesB.find((s) => s.provider === "openai")?.hint).toBe("5678");
  });

  it("a replaced key is used from the next piece of work", async () => {
    await withMakerKeys(a.id, async () => providerKey("openai"));
    await saveProviderKey(a.id, "openai", "sk-test-replacedreplaced9999");
    expect(await withMakerKeys(a.id, async () => providerKey("openai"))).toBe(
      "sk-test-replacedreplaced9999",
    );
  });

  it("saving the team key again keeps its one row and its id", async () => {
    const before = await db.providerKey.findMany({
      where: { makerId: a.id, provider: "openai" },
    });
    expect(before).toHaveLength(1);
    await saveProviderKey(a.id, "openai", "sk-test-againagainagain7777");
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
    await expect(saveProviderKey(a.id, "google", "short")).rejects.toThrow(
      /too short/,
    );
    await expect(
      saveProviderKey(a.id, "google", "two words that are long enough"),
    ).rejects.toThrow(/no spaces/);
    await removeProviderKey(a.id, "openai");
    expect(
      await withMakerKeys(a.id, async () => providerKey("openai")),
    ).toBeUndefined();
    expect(await db.providerKey.count({ where: { makerId: a.id } })).toBe(0);
    expect(await db.providerKey.count({ where: { makerId: b.id } })).toBe(1);
  });
});
