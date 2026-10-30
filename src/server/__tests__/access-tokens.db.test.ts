import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("access tokens (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/access-tokens");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  // Set up when the suite runs, never while a skipped suite is collected.
  let maker: { id: string };
  let other: { id: string };
  const made: string[] = [];

  beforeAll(async () => {
    maker = await getCurrentMaker();
    other = await db.maker.upsert({
      where: { slug: "tokens-other-maker" },
      create: { slug: "tokens-other-maker", name: "Another maker" },
      update: {},
    });
  });

  afterAll(async () => {
    await db.accessToken.deleteMany({ where: { id: { in: made } } });
    await db.maker.delete({ where: { id: other.id } });
  });

  it("a token is listed by name and prefix, never by its value or hash", async () => {
    const { token, created } = await repo.createAccessToken(" CLI test ");
    made.push(created.id);
    expect(created).toMatchObject({ name: "CLI test", lastUsedAt: null });
    expect(token.startsWith(created.prefix)).toBe(true);
    const listed = (await repo.listAccessTokens()).find(
      (t) => t.id === created.id,
    );
    expect(listed).toEqual(created);
    expect(JSON.stringify(listed)).not.toContain(token);
    const row = await db.accessToken.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.hash).toBe(repo.hashToken(token));
    expect(row.makerId).toBe(maker.id);
  });

  it("verifying a token gives its maker and stamps its last use; an unknown one gives nothing", async () => {
    const { token, created } = await repo.createAccessToken("Verify test");
    made.push(created.id);
    expect(await repo.verifyAccessToken(token)).toEqual({
      tokenId: created.id,
      makerId: maker.id,
      name: "Verify test",
      canSpend: false,
    });
    const used = (await repo.listAccessTokens()).find(
      (t) => t.id === created.id,
    );
    expect(used?.lastUsedAt).not.toBeNull();
    expect(await repo.verifyAccessToken(repo.newToken().token)).toBeNull();
  });

  it("a token made for another maker does not act here", async () => {
    const { token, prefix, hash } = repo.newToken();
    const row = await db.accessToken.create({
      data: { makerId: other.id, name: "Elsewhere", prefix, hash },
    });
    made.push(row.id);
    expect(await repo.verifyAccessToken(token)).toBeNull();
    expect(await repo.revokeAccessToken(row.id)).toBe(false);
  });

  it("a revoked token is refused at once", async () => {
    const { token, created } = await repo.createAccessToken("Revoke test");
    expect(await repo.revokeAccessToken(created.id)).toBe(true);
    expect(await repo.verifyAccessToken(token)).toBeNull();
    expect(await repo.revokeAccessToken(created.id)).toBe(false);
    expect(
      (await repo.listAccessTokens()).some((t) => t.id === created.id),
    ).toBe(false);
  });
});
