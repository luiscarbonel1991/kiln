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
