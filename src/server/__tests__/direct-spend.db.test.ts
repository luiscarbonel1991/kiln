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
    const { ProviderKeyMissing } = await import("@/providers/errors");

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

    it("a member's refusal is the engine's missing-key error, and leaves no row", async () => {
      const before = await rows();
      const error = await withProviderKeys({}, () =>
        withDirectSpend(
          member(),
          textCall<string>(LUNA, "chatTurn"),
          async () => answer,
        ),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderKeyMissing);
      expect(error).toMatchObject({
        name: "ProviderKeyMissing",
        provider: "openai",
        message: "You have no access to an OpenAI key; ask Ana.",
      });
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

// A direct call records the key it is reserved on, from the scope its maker's
// work runs in: Bob's on his own key, Carla's and a token's on the team's.
// Fixture keys; the call is a stub.
describe.skipIf(!enabled)(
  "the key a direct call runs on (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { withMakerKeys } = await import("@/server/provider-keys");
    const { textCall, withDirectSpend } = await import("@/server/direct-spend");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");

    let studio: Awaited<ReturnType<typeof fx.openStudio>>;
    const ids: Record<string, string> = {};
    const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };
    const answer: TextResult<string> = { value: "", model: LUNA.model };

    beforeAll(async () => {
      studio = await fx.openStudio("direct-keys");
      ids.team = await fx.writeKey(studio, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-direct-team-00000001",
      });
      ids.bob = await fx.writeKey(studio, {
        provider: "openai",
        name: "Bob's key",
        secret: "sk-fixture-direct-bob-000000002",
        people: [studio.bob],
      });
    });

    afterAll(async () => {
      await fx.closeStudio(studio);
    });

    const callAs = async (maker: Parameters<typeof withMakerKeys>[0]) => {
      const before = (
        await db.generationJob.findMany({
          where: { makerId: studio.makerId },
          select: { id: true },
        })
      ).map((r) => r.id);
      await withMakerKeys(maker, () =>
        withDirectSpend(
          maker,
          textCall<string>(LUNA, "chatTurn"),
          async () => answer,
        ),
      );
      const made = await db.generationJob.findMany({
        where: { makerId: studio.makerId, id: { notIn: before } },
      });
      expect(made).toHaveLength(1);
      return made[0];
    };

    it("Bob's direct call carries his key's id", async () => {
      expect(await callAs(studio.as(studio.bob))).toMatchObject({
        memberId: studio.bob.memberId,
        providerKeyId: ids.bob,
      });
    });

    it("Carla's and a token's direct call carry the team key's id", async () => {
      expect((await callAs(studio.as(studio.carla))).providerKeyId).toBe(
        ids.team,
      );
      expect((await callAs(studio.as())).providerKeyId).toBe(ids.team);
    });
  },
);

// A studio whose OpenAI keys are all for someone else, and one whose team key
// cannot be read: each reader's direct call is refused, before any row is
// reserved, in the sentence of their case. Run inside each reader's own keys,
// as every entry point runs. Fixture keys; the call is a stub.
describe.skipIf(!enabled)(
  "a direct call refused by the reader's reach (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const { withMakerKeys } = await import("@/server/provider-keys");
    const { textCall, withDirectSpend } = await import("@/server/direct-spend");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;
    type Ref = Parameters<typeof withMakerKeys>[0];

    let given: Studio;
    let unreadable: Studio;
    const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };
    const answer: TextResult<string> = { value: "", model: LUNA.model };

    beforeAll(async () => {
      // Only Bob holds an OpenAI key; the studio has no team key.
      given = await fx.openStudio("direct-reach-given");
      await fx.writeKey(given, {
        provider: "openai",
        name: "Bob's key",
        secret: "sk-fixture-direct-reach-bob-0001",
        people: [given.bob],
      });
      // The team key cannot be read.
      unreadable = await fx.openStudio("direct-reach-unreadable");
      await fx.writeKey(unreadable, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-direct-reach-team-0002",
        unreadable: true,
      });
    });

    afterAll(async () => {
      await fx.closeStudio(given);
      await fx.closeStudio(unreadable);
    });

    const rows = (studio: Studio) =>
      db.generationJob.findMany({ where: { makerId: studio.makerId } });

    const refusedAs = async (studio: Studio, maker: Ref) => {
      const before = await rows(studio);
      const call = vi.fn(async () => answer);
      const error = await withMakerKeys(maker, () =>
        withDirectSpend(maker, textCall<string>(LUNA, "chatTurn"), call),
      ).catch((e: unknown) => e);
      expect(call).not.toHaveBeenCalled();
      expect(await rows(studio)).toEqual(before);
      return error;
    };

    it("when the only OpenAI key is Bob's, the owner, Carla and a token each read their case, and nothing is reserved", async () => {
      expect(await refusedAs(given, given.as(given.ana))).toMatchObject({
        name: "ProviderKeyMissing",
        message:
          "No OpenAI key is yours or the team's: add one in Settings → Providers.",
      });
      expect(await refusedAs(given, given.as(given.carla))).toMatchObject({
        name: "ProviderKeyMissing",
        message: "You have no access to an OpenAI key; ask Ana.",
      });
      expect(await refusedAs(given, given.as())).toMatchObject({
        name: "ProviderKeyMissing",
        message:
          "OpenAI has no key for the whole team, the only one a token runs on: add one in Settings → Providers.",
      });
    });

    it("when the team key cannot be read, the owner and a token read that it cannot, and a member whom to ask", async () => {
      expect(
        await refusedAs(unreadable, unreadable.as(unreadable.ana)),
      ).toMatchObject({
        name: "ProviderKeyMissing",
        message:
          "The OpenAI key your calls run on cannot be read: replace it in Settings → Providers.",
      });
      expect(await refusedAs(unreadable, unreadable.as())).toMatchObject({
        name: "ProviderKeyMissing",
        message:
          "The team's OpenAI key cannot be read: replace it in Settings → Providers.",
      });
      expect(
        await refusedAs(unreadable, unreadable.as(unreadable.bob)),
      ).toMatchObject({
        name: "ProviderKeyMissing",
        message: "You have no access to an OpenAI key; ask Ana.",
      });
    });
  },
);
