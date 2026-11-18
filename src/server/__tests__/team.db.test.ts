import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "joining a studio by invitation (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { getAuth, INVITATION_HEADER } = await import("@/server/auth");
    const { makerOfMember } = await import("@/server/organization");
    const { joinWithInvitation, listTeam, openInvitation, removeMember } =
      await import("@/server/team");

    const stamp = randomUUID().slice(0, 8);
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const ownerMemberId = randomUUID();
    let makerId = "";
    const emails: string[] = [];

    const invite = async (
      email: string,
      expiresAt = new Date(Date.now() + 86_400_000),
    ) => {
      const id = randomUUID();
      await db.invitation.create({
        data: {
          id,
          organizationId,
          email,
          role: "member",
          status: "pending",
          expiresAt,
          inviterId: ownerId,
        },
      });
      emails.push(email);
      return id;
    };

    const signUp = (email: string, invitationId?: string) =>
      getAuth().api.signUpEmail({
        body: { name: "New", email, password: "a-long-test-password" },
        headers: new Headers({
          host: "localhost:3000",
          ...(invitationId ? { [INVITATION_HEADER]: invitationId } : {}),
        }),
      });

    beforeAll(async () => {
      await db.user.create({
        data: { id: ownerId, name: "Owner", email: `owner-${stamp}@kiln.test` },
      });
      await db.organization.create({
        data: {
          id: organizationId,
          name: "Team Studio",
          slug: `team-${stamp}`,
          createdAt: new Date(),
        },
      });
      await db.member.create({
        data: {
          id: ownerMemberId,
          organizationId,
          userId: ownerId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      const maker = await db.maker.create({
        data: { slug: `team-${stamp}`, name: "Team Studio", organizationId },
      });
      makerId = maker.id;
    });

    afterAll(async () => {
      await db.maker.deleteMany({ where: { id: makerId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({
        where: { OR: [{ id: ownerId }, { email: { in: emails } }] },
      });
    });

    it("makes no account without an invitation once the instance has its owner", async () => {
      await expect(signUp(`stranger-${stamp}@kiln.test`)).rejects.toThrow(
        /already has its owner/,
      );
      const id = await invite(`someone-${stamp}@kiln.test`);
      await expect(signUp(`another-${stamp}@kiln.test`, id)).rejects.toThrow(
        /already has its owner/,
      );
    });

    it("makes the account for the invited email, and it joins as a member", async () => {
      const email = `ana-${stamp}@kiln.test`;
      const id = await invite(email);
      expect(await openInvitation(id)).toMatchObject({
        email,
        studio: "Team Studio",
        hasAccount: false,
      });
      const { user } = await signUp(email, id);
      await joinWithInvitation({ invitationId: id, userId: user.id, email });
      const maker = await makerOfMember({ userId: user.id });
      expect(maker).toMatchObject({ id: makerId, member: { role: "member" } });
      expect(await openInvitation(id)).toBeNull();
      await expect(
        joinWithInvitation({ invitationId: id, userId: user.id, email }),
      ).rejects.toThrow(/used, cancelled or has expired/);
      const team = await listTeam({
        id: makerId,
        slug: "",
        name: "",
        member: { id: ownerMemberId, userId: ownerId, role: "owner" },
      });
      expect(team.members.map((m) => [m.email, m.role, m.you])).toEqual([
        [`owner-${stamp}@kiln.test`, "owner", true],
        [email, "member", false],
      ]);
    });

    it("an expired invitation and another person's email are refused", async () => {
      const expired = await invite(
        `late-${stamp}@kiln.test`,
        new Date(Date.now() - 1000),
      );
      expect(await openInvitation(expired)).toBeNull();
      const id = await invite(`ben-${stamp}@kiln.test`);
      await expect(
        joinWithInvitation({
          invitationId: id,
          userId: ownerId,
          email: `owner-${stamp}@kiln.test`,
        }),
      ).rejects.toThrow(/is for ben-/);
    });

    it("the owner stays on the team", async () => {
      await expect(
        removeMember({ id: makerId, slug: "", name: "" }, ownerMemberId),
      ).rejects.toThrow(/owner stays/);
    });
  },
);

// The month's spend per person: the owner sees one line per person, named
// only from their own studio, their own marked as theirs; a member sees only
// their own line. Three studios, each with its own people; C has no work.
describe.skipIf(!enabled)(
  "the month's spend per person (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { spendByMember } = await import("@/server/generation-repository");
    const { monthSpend } = await import("@/server/team");

    const stamp = randomUUID().slice(0, 8);
    const studios = {
      a: { org: randomUUID(), maker: "" },
      b: { org: randomUUID(), maker: "" },
      c: { org: randomUUID(), maker: "" },
    };
    const people = {
      ownerA: { member: randomUUID(), user: randomUUID(), name: "Olga Owner" },
      ana: { member: randomUUID(), user: randomUUID(), name: "Ana Ruiz" },
      ownerB: { member: randomUUID(), user: randomUUID(), name: "Bruno Other" },
      cleo: { member: randomUUID(), user: randomUUID(), name: "Cleo New" },
    };
    let bare = "";

    const as = (
      studio: keyof typeof studios,
      person: keyof typeof people,
      role: "owner" | "member",
    ) => ({
      id: studios[studio].maker,
      slug: "",
      name: "",
      member: { id: people[person].member, userId: people[person].user, role },
    });

    const spent = (
      makerId: string,
      memberId: string | null,
      micros: number,
    ) => ({
      makerId,
      memberId,
      cardId: "direct",
      mode: "live",
      status: "done",
      maxAttempts: 1,
      estimateMicros: micros,
      actualMicros: micros,
      finishedAt: new Date(),
    });

    beforeAll(async () => {
      for (const [key, studio] of Object.entries(studios)) {
        await db.organization.create({
          data: {
            id: studio.org,
            name: `Spend ${key}`,
            slug: `spend-${key}-${stamp}`,
            createdAt: new Date(),
          },
        });
        const maker = await db.maker.create({
          data: {
            slug: `spend-${key}-${stamp}`,
            name: `Spend ${key}`,
            organizationId: studio.org,
          },
        });
        studio.maker = maker.id;
      }
      const join = [
        [people.ownerA, studios.a.org, "owner"],
        [people.ana, studios.a.org, "member"],
        [people.ownerB, studios.b.org, "owner"],
        [people.cleo, studios.c.org, "member"],
      ] as const;
      for (const [person, organizationId, role] of join) {
        await db.user.create({
          data: {
            id: person.user,
            name: person.name,
            email: `${person.user}@kiln.test`,
          },
        });
        await db.member.create({
          data: {
            id: person.member,
            organizationId,
            userId: person.user,
            role,
            createdAt: new Date(),
          },
        });
      }
      bare = (
        await db.maker.create({
          data: { slug: `spend-bare-${stamp}`, name: "No team" },
        })
      ).id;
      await db.generationJob.createMany({
        data: [
          spent(studios.a.maker, people.ownerA.member, 4_000),
          spent(studios.a.maker, people.ana.member, 9_000),
          spent(studios.a.maker, null, 800),
          // Another studio's member id on A's work: never named by A.
          spent(studios.a.maker, people.ownerB.member, 3_100),
          spent(studios.b.maker, people.ownerB.member, 6_000),
        ],
      });
    });

    afterAll(async () => {
      const makers = [...Object.values(studios).map((s) => s.maker), bare];
      await db.generationJob.deleteMany({ where: { makerId: { in: makers } } });
      await db.maker.deleteMany({ where: { id: { in: makers } } });
      await db.organization.deleteMany({
        where: { id: { in: Object.values(studios).map((s) => s.org) } },
      });
      await db.user.deleteMany({
        where: { id: { in: Object.values(people).map((p) => p.user) } },
      });
    });

    const lines = (rows: { name: string; spentMicros: number }[]) =>
      rows.map((r) => [r.name, r.spentMicros]);

    it("the owner sees one line per person, highest first, named only from their own studio", async () => {
      const rows = await monthSpend(as("a", "ownerA", "owner"));
      expect(lines(rows)).toEqual([
        ["Ana Ruiz", 9_000],
        ["Olga Owner", 4_000],
        ["Someone who left", 3_100],
        ["Not started by a person", 800],
      ]);
      expect(JSON.stringify(rows)).not.toContain("Bruno Other");
      // Their own line reads "Olga Owner · you".
      expect(rows.filter((r) => r.you).map((r) => r.name)).toEqual([
        "Olga Owner",
      ]);
    });

    it("a member sees only their own line, as You", async () => {
      expect(lines(await monthSpend(as("a", "ana", "member")))).toEqual([
        ["You", 9_000],
      ]);
    });

    it("a member who spent nothing sees their own line at $0", async () => {
      expect(lines(await monthSpend(as("c", "cleo", "member")))).toEqual([
        ["You", 0],
      ]);
    });

    it("each studio reads only its own rows and names only its own people", async () => {
      expect(lines(await monthSpend(as("b", "ownerB", "owner")))).toEqual([
        ["Bruno Other", 6_000],
      ]);
      expect(await spendByMember({ id: studios.b.maker })).toEqual([
        { memberId: people.ownerB.member, spentMicros: 6_000 },
      ]);
      expect(
        (await spendByMember({ id: studios.a.maker })).map(
          (r) => r.spentMicros,
        ),
      ).toEqual([9_000, 4_000, 3_100, 800]);
    });

    it("a studio with no team reads no lines instead of failing Settings", async () => {
      expect(await monthSpend({ id: bare, slug: "", name: "" })).toEqual([]);
    });
  },
);
