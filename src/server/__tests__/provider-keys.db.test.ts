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
    makerProviderKeys,
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
    await makerProviderKeys(a.id);
    await saveProviderKey(a.id, "openai", "sk-test-replacedreplaced9999");
    expect(await withMakerKeys(a.id, async () => providerKey("openai"))).toBe(
      "sk-test-replacedreplaced9999",
    );
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
