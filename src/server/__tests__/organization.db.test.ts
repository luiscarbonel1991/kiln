import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("claiming an instance (database)", async () => {
  const { db } = await import("@/lib/db");
  const { env } = await import("@/lib/env");
  const { AlreadyClaimed, claimInstance, instanceClaimed, makerOfMember } =
    await import("@/server/organization");
  const { getCurrentMaker } = await import("@/server/maker-repository");

  const users: string[] = [];
  const newUser = async () => {
    const id = randomUUID();
    await db.user.create({
      data: { id, name: "Test", email: `${id}@kiln.test` },
    });
    users.push(id);
    return id;
  };
  let before: string | null = null;

  beforeAll(async () => {
    const maker = await db.maker.findUnique({
      where: { slug: env.KILN_MAKER },
      select: { organizationId: true },
    });
    before = maker?.organizationId ?? null;
    await db.maker.updateMany({
      where: { slug: env.KILN_MAKER },
      data: { organizationId: null },
    });
  });

  afterAll(async () => {
    const made = await db.member.findMany({
      where: { userId: { in: users } },
      select: { organizationId: true },
    });
    await db.maker.updateMany({
      where: { slug: env.KILN_MAKER },
      data: { organizationId: before },
    });
    await db.organization.deleteMany({
      where: { id: { in: made.map((m) => m.organizationId) } },
    });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  it("gives the first account the maker this instance worked for", async () => {
    const working = await getCurrentMaker();
    const owner = await newUser();
    const { organizationId } = await claimInstance({
      userId: owner,
      company: "Test Studio",
    });
    expect(await instanceClaimed()).toBe(true);
    const maker = await makerOfMember({ userId: owner });
    expect(maker?.id).toBe(working.id);
    const member = await db.member.findFirst({ where: { userId: owner } });
    expect(member).toMatchObject({ organizationId, role: "owner" });
  });

  it("refuses a second claim and leaves no organization behind", async () => {
    const second = await newUser();
    const count = await db.organization.count();
    await expect(
      claimInstance({ userId: second, company: "Another" }),
    ).rejects.toBeInstanceOf(AlreadyClaimed);
    expect(await db.organization.count()).toBe(count);
    expect(await makerOfMember({ userId: second })).toBeNull();
  });
});
