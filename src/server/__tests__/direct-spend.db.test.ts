import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TextResult } from "@/providers/interfaces";

// Against the throwaway Postgres (see project-repository.db.test.ts): a
// direct call whose provider has no key in reach is refused before a row is
// reserved for it. Its own studio, scoped to its own rows; the keys are
// fixtures and the call is a stub, so no provider is asked.
vi.mock("@/providers/mode", async (original) => ({
  ...(await original<typeof import("@/providers/mode")>()),
  providerMode: () => "live",
}));

const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "a direct call with no key in reach (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { withProviderKeys } = await import("@/providers/keys");
    const { textCall, withDirectSpend } = await import("@/server/direct-spend");

    const stamp = randomUUID().slice(0, 8);
    const organizationId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerMemberId = randomUUID();
    let makerId = "";

    const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };
    const answer: TextResult<string> = { value: "", model: LUNA.model };
    const member = () => ({
      id: makerId,
      member: { id: "mem-1", userId: "user-1", role: "member" as const },
    });
    const owner = () => ({
      id: makerId,
      member: {
        id: ownerMemberId,
        userId: ownerUserId,
        role: "owner" as const,
      },
    });
    const rows = () => db.generationJob.findMany({ where: { makerId } });

    beforeAll(async () => {
      await db.user.create({
        data: {
          id: ownerUserId,
          name: "Ana Ruiz",
          email: `direct-owner-${stamp}@kiln.test`,
        },
      });
      await db.organization.create({
        data: {
          id: organizationId,
          name: "Direct Studio",
          slug: `direct-${stamp}`,
          createdAt: new Date(),
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
          slug: `direct-${stamp}`,
          name: "Direct Studio",
          organizationId,
          monthlyCapCents: 100,
        },
      });
      makerId = maker.id;
    });

    afterAll(async () => {
      await db.generationJob.deleteMany({ where: { makerId } });
      await db.maker.deleteMany({ where: { id: makerId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({ where: { id: ownerUserId } });
    });

    it("a member's call is refused in their words and leaves no row for the studio", async () => {
      const before = await rows();
      const call = vi.fn(async () => answer);
      await expect(
        withProviderKeys({}, () =>
          withDirectSpend(member(), textCall<string>(LUNA, "chatTurn"), call),
        ),
      ).rejects.toMatchObject({
        name: "ProviderKeyMissing",
        message: "You have no access to an OpenAI key; ask Ana.",
      });
      expect(call).not.toHaveBeenCalled();
      expect(await rows()).toEqual(before);
    });

    it("the owner's and a token's call is refused in the owner's words and leaves no row", async () => {
      const before = await rows();
      for (const reader of [owner(), { id: makerId }]) {
        const call = vi.fn(async () => answer);
        await expect(
          withProviderKeys({}, () =>
            withDirectSpend(reader, textCall<string>(LUNA, "chatTurn"), call),
          ),
        ).rejects.toMatchObject({
          name: "ProviderKeyMissing",
          message: "OpenAI has no API key: add one in Settings → Providers.",
        });
        expect(call).not.toHaveBeenCalled();
      }
      expect(await rows()).toEqual(before);
    });

    it("a key for another provider does not put this one in reach", async () => {
      const before = await rows();
      await expect(
        withProviderKeys({ google: "fixture-google-key" }, () =>
          withDirectSpend(
            member(),
            textCall<string>(LUNA, "chatTurn"),
            async () => answer,
          ),
        ),
      ).rejects.toMatchObject({ name: "ProviderKeyMissing" });
      expect(await rows()).toEqual(before);
    });

    // The same call with a key in reach reserves its row in the member's
    // name: the cases above prove the order, not a reserve that cannot work.
    it("with a key in reach the same call reserves one row, in the member's name", async () => {
      const before = (await rows()).map((r) => r.id);
      await withProviderKeys({ openai: "sk-fixture-not-a-key" }, () =>
        withDirectSpend(
          member(),
          textCall<string>(LUNA, "chatTurn"),
          async () => answer,
        ),
      );
      const made = (await rows()).filter((r) => !before.includes(r.id));
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({
        makerId,
        memberId: "mem-1",
        cardId: "direct",
        mode: "live",
      });
    });
  },
);
