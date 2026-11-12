import { afterAll, describe, expect, it, vi } from "vitest";

// Against a migrated throwaway Postgres (see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("provider keys (database)", async () => {
  const slug = `keys-${Date.now()}`;
  vi.stubEnv("KILN_MAKER", slug);
  const { db } = await import("@/lib/db");
  const { providerKey, setProviderKey } = await import("@/providers/keys");
  const {
    ensureProviderKeys,
    providerKeyStates,
    removeProviderKey,
    saveProviderKey,
  } = await import("@/server/provider-keys");

  afterAll(async () => {
    setProviderKey("openai", null);
    await db.maker.deleteMany({ where: { slug } });
  });

  it("keeps a key sealed, hands it to the engine, and names only its last four", async () => {
    await saveProviderKey("openai", "  sk-test-abcdefghijklmnop1234  ");
    const row = await db.providerKey.findFirstOrThrow({
      where: { maker: { slug }, provider: "openai" },
    });
    expect(row.sealed).not.toContain("abcdefghijklmnop");
    expect(row.sealed.startsWith("v1.")).toBe(true);
    expect(row.hint).toBe("1234");
    expect(providerKey("openai")).toBe("sk-test-abcdefghijklmnop1234");
    const states = await providerKeyStates();
    expect(states.find((s) => s.provider === "openai")).toEqual({
      provider: "openai",
      source: "saved",
      hint: "1234",
      unreadable: false,
    });
  });

  it("a new process reads the saved key back", async () => {
    setProviderKey("openai", null);
    const cache = globalThis as { __kilnProviderKeysLoaded?: unknown };
    cache.__kilnProviderKeysLoaded = undefined;
    await ensureProviderKeys();
    expect(providerKey("openai")).toBe("sk-test-abcdefghijklmnop1234");
  });

  it("refuses what cannot be a key, and removing one leaves no row", async () => {
    await expect(saveProviderKey("google", "short")).rejects.toThrow(
      /too short/,
    );
    await expect(
      saveProviderKey("google", "two words that are long enough"),
    ).rejects.toThrow(/no spaces/);
    await removeProviderKey("openai");
    expect(providerKey("openai")).toBeUndefined();
    expect(await db.providerKey.count({ where: { maker: { slug } } })).toBe(0);
  });
});
