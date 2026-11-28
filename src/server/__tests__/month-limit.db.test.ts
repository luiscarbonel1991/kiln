import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup): what each caller reads of
// this month's limit. Its own studio, scoped to its own rows.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "this month's limit by caller (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { fitsThisMonth, memberAsk, monthLimit, whomToAsk } = await import(
      "@/server/month-limit"
    );
    const { ownerContact } = await import("@/server/studio-owner");

    const stamp = randomUUID().slice(0, 8);
    const organizationId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerMemberId = randomUUID();
    // A role that only contains the word: never taken for the owner.
    const coUserId = randomUUID();
    let makerId = "";
    let loneId = "";

    const owner = () => ({
      id: makerId,
      member: {
        id: ownerMemberId,
        userId: ownerUserId,
        role: "owner" as const,
      },
    });
    const member = (id = makerId) => ({
      id,
      member: { id: "mem-1", userId: "user-1", role: "member" as const },
    });

    beforeAll(async () => {
      await db.user.create({
        data: {
          id: ownerUserId,
          name: "Ana Ruiz",
          email: `limit-owner-${stamp}@kiln.test`,
        },
      });
      await db.organization.create({
        data: {
          id: organizationId,
          name: "Limit Studio",
          slug: `limit-${stamp}`,
          createdAt: new Date(),
        },
      });
      await db.user.create({
        data: {
          id: coUserId,
          name: "Cora Diaz",
          email: `limit-co-${stamp}@kiln.test`,
        },
      });
      await db.member.create({
        data: {
          id: randomUUID(),
          organizationId,
          userId: coUserId,
          role: "co-owner",
          createdAt: new Date(Date.now() - 86_400_000),
        },
      });
      await db.member.create({
        data: {
          id: ownerMemberId,
          organizationId,
          userId: ownerUserId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      const maker = await db.maker.create({
        data: {
          slug: `limit-${stamp}`,
          name: "Limit Studio",
          organizationId,
          monthlyCapCents: 100,
        },
      });
      makerId = maker.id;
      const lone = await db.maker.create({
        data: {
          slug: `limit-lone-${stamp}`,
          name: "No team",
          monthlyCapCents: 100,
        },
      });
      loneId = lone.id;
      // $0.40 spent this month, $0.30 queued.
      await db.generationJob.createMany({
        data: [
          {
            makerId,
            cardId: "c1",
            mode: "live",
            status: "done",
            maxAttempts: 1,
            request: {},
            estimateMicros: 400_000,
            actualMicros: 400_000,
            finishedAt: new Date(),
            memberId: "mem-1",
          },
          {
            makerId,
            cardId: "c2",
            mode: "live",
            status: "running",
            maxAttempts: 1,
            // Held, so no sweep in another test requeues it.
            leaseUntil: new Date(Date.now() + 3_600_000),
            request: {},
            estimateMicros: 300_000,
          },
        ],
      });
    });

    afterAll(async () => {
      await db.generationJob.deleteMany({
        where: { makerId: { in: [makerId, loneId] } },
      });
      await db.maker.deleteMany({ where: { id: { in: [makerId, loneId] } } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({
        where: { id: { in: [ownerUserId, coUserId] } },
      });
    });

    it("the owner reads the studio's amounts", async () => {
      expect(await monthLimit(owner())).toEqual({
        whose: "studio",
        spentMicros: 400_000,
        reservedMicros: 300_000,
        capMicros: 1_000_000,
      });
    });

    it("a token or a script (no person) reads the studio's amounts", async () => {
      expect(await monthLimit({ id: makerId })).toMatchObject({
        whose: "studio",
        capMicros: 1_000_000,
      });
    });

    it("a member reads only whom to ask, with no amount at all", async () => {
      const limit = await monthLimit(member());
      expect(limit).toEqual({ whose: "member", ask: "Ana" });
      expect(JSON.stringify(limit)).not.toMatch(/Micros|cap|spent|reserved/i);
    });

    it("the owner is named by their role, not a role that contains the word", async () => {
      expect(await whomToAsk(member())).toBe("Ana");
    });

    it("a studio with no team names no one", async () => {
      expect(await whomToAsk(member(loneId))).toBe("the studio's owner");
    });

    // Who reads decides the words about a key: a member gets whom to ask,
    // the owner and work with no person (a token, a script, the worker) get
    // null, which reads as the owner.
    it("a member is told whom to ask; the owner and work with no person are not", async () => {
      expect(await memberAsk(member())).toBe("Ana");
      expect(await memberAsk(member(loneId))).toBe("the studio's owner");
      expect(await memberAsk(owner())).toBeNull();
      expect(await memberAsk({ id: makerId })).toBeNull();
    });

    it("work fits while spent, queued and its cost stay within the cap", async () => {
      expect(await fitsThisMonth(member(), 300_000)).toBe(true);
      expect(await fitsThisMonth(member(), 300_001)).toBe(false);
    });

    // The owner as a member reaches them: their name, first name and email,
    // and nothing else.
    it("names the owner with their email, never a role that only contains the word", async () => {
      const contact = await ownerContact(member());
      expect(contact).toEqual({
        name: "Ana Ruiz",
        firstName: "Ana",
        email: `limit-owner-${stamp}@kiln.test`,
      });
      expect(JSON.stringify(contact)).not.toContain("Cora");
      expect(await ownerContact(owner())).toEqual(contact);
      expect(await ownerContact({ id: makerId })).toEqual(contact);
    });

    it("a studio with no team has no owner to name", async () => {
      expect(await ownerContact(member(loneId))).toBeNull();
    });
  },
);

// Two studios of the shared fixture, each with its own Ana: the owner named
// is always the studio's handed down, whoever is asking.
describe.skipIf(!enabled)(
  "the studio's owner, by studio (database)",
  async () => {
    const { ownerContact } = await import("@/server/studio-owner");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;

    let one: Studio;
    let two: Studio;

    beforeAll(async () => {
      one = await fx.openStudio("owner-one");
      two = await fx.openStudio("owner-two");
    });

    afterAll(async () => {
      await fx.closeStudio(one);
      await fx.closeStudio(two);
    });

    it("each studio names its own owner", async () => {
      expect(await ownerContact(one.as(one.bob))).toEqual({
        name: "Ana Ruiz",
        firstName: "Ana",
        email: one.ana.email,
      });
      expect(await ownerContact(two.as(two.carla))).toEqual({
        name: "Ana Ruiz",
        firstName: "Ana",
        email: two.ana.email,
      });
    });

    it("a person of one studio handed another studio's maker reads that studio's owner, never their own", async () => {
      const crossed = { id: two.makerId, member: one.as(one.bob).member };
      const contact = await ownerContact(crossed);
      expect(contact?.email).toBe(two.ana.email);
      expect(JSON.stringify(contact)).not.toContain(one.ana.email);
    });
  },
);
