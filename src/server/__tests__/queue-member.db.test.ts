import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  lineArtDesign,
  lineArtDrawing,
} from "@/server/__tests__/fixtures/line-art-design";

// enqueueProjectCards against the throwaway Postgres (see
// project-repository.db.test.ts): the maker ref the session hands down
// carries the person working, and every job the batch queues records them.
// Its own maker, a mode no worker claims, and no worker started.
const keys = vi.hoisted(() => ({ present: true }));
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: () => keys.present,
}));
// Live while the database client is made (a mock process uses another
// database), then a mode no worker claims.
const mode = vi.hoisted(() => ({ current: "live" }));
vi.mock("@/providers/mode", async (original) => ({
  ...(await original<typeof import("@/providers/mode")>()),
  providerMode: () => mode.current,
}));
vi.mock("@/server/generation-worker", async (original) => ({
  ...(await original<typeof import("@/server/generation-worker")>()),
  createWorker: () => ({
    wake: () => {},
    stop: () => {},
    active: () => 0,
    idle: async () => {},
  }),
}));

const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("a batch queued by a person (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { enqueueProjectCards, estimateProjectCards, fitsProjectCards } =
    await import("@/server/generation-queue");
  mode.current = "queue-member";

  const slug = `queue-member-${Date.now()}`;
  let makerId = "";
  let projectId = "";

  const editor = lineArtDesign("Queue member design", [
    lineArtDrawing(0, "Outline"),
    lineArtDrawing(1, "Detail"),
    lineArtDrawing(2, "Badge"),
  ]);

  beforeAll(async () => {
    const maker = await db.maker.create({
      data: { slug, name: "Queue member test", monthlyCapCents: 100 },
    });
    makerId = maker.id;
    projectId = await repo.saveProject({ id: makerId }, editor);
  });

  afterAll(async () => {
    await db.generationJob.deleteMany({ where: { makerId } });
    await db.generationBatch.deleteMany({ where: { makerId } });
    await db.project.deleteMany({ where: { makerId } });
    await db.maker.delete({ where: { id: makerId } });
  });

  const jobsOf = (batchId: string) =>
    db.generationJob.findMany({ where: { batchId } });

  // The session's maker ref carries its member down to every job.
  it("a batch queued from a session stores the person on every job", async () => {
    const session = {
      id: makerId,
      member: { id: "m1", userId: "u1", role: "member" as const },
    };
    const queued = await enqueueProjectCards(session, {
      projectId,
      cardIds: ["recipe-line-art-0"],
    });
    expect(queued.queued).toBe(1);
    const jobs = await jobsOf(queued.batchId);
    expect(jobs.map((j) => j.memberId)).toEqual(["m1"]);
  });

  // Over this month's limit (a live batch, a cap of $0): a member is told
  // whom to ask, with no amount; the owner reads the queue's own refusal.
  it("a member over this month's limit is refused in their words", async () => {
    await db.maker.update({
      where: { id: makerId },
      data: { monthlyCapCents: 0 },
    });
    mode.current = "live";
    try {
      const asMember = enqueueProjectCards(
        {
          id: makerId,
          member: { id: "m1", userId: "u1", role: "member" },
        },
        { projectId, cardIds: ["recipe-line-art-2"] },
      );
      await expect(asMember).rejects.toMatchObject({
        reason: "cap",
        message: "Over this month's limit: ask the studio's owner.",
      });
      const asOwner = enqueueProjectCards(
        { id: makerId, member: { id: "o1", userId: "u0", role: "owner" } },
        { projectId, cardIds: ["recipe-line-art-2"] },
      );
      await expect(asOwner).rejects.toMatchObject({
        reason: "cap",
        message: "This batch would go over this month's spending cap.",
      });
    } finally {
      mode.current = "queue-member";
      await db.maker.update({
        where: { id: makerId },
        data: { monthlyCapCents: 100 },
      });
    }
  });

  // The yes or no a member reads before the click, from the card's own
  // estimate: within a $1 cap it fits, under a $0 cap it does not.
  it("a batch fits this month's limit by its own estimate", async () => {
    const member = {
      id: makerId,
      member: { id: "m1", userId: "u1", role: "member" as const },
    };
    const ask = { projectId, cardIds: ["recipe-line-art-2"] };
    mode.current = "live";
    try {
      const { cards } = await estimateProjectCards(member, projectId, [
        "recipe-line-art-2",
      ]);
      expect(cards[0].maxMicros).toBeGreaterThan(0);
      expect(await fitsProjectCards(member, ask)).toBe(true);
      await db.maker.update({
        where: { id: makerId },
        data: { monthlyCapCents: 0 },
      });
      expect(await fitsProjectCards(member, ask)).toBe(false);
    } finally {
      mode.current = "queue-member";
      await db.maker.update({
        where: { id: makerId },
        data: { monthlyCapCents: 100 },
      });
    }
    // Work that is not live counts nothing against the limit.
    expect(await fitsProjectCards(member, ask)).toBe(true);
  });

  // A live batch whose card's provider has no key in reach is refused
  // before anything is queued: a member is told whom to ask (this studio has
  // no team, so no name); the owner, a token and a script read where to add
  // the key, as before.
  it("a batch with no key in reach is refused in the reader's words, and nothing is queued", async () => {
    const card = "recipe-line-art-2";
    const member = {
      id: makerId,
      member: { id: "m1", userId: "u1", role: "member" as const },
    };
    const owner = {
      id: makerId,
      member: { id: "o1", userId: "u0", role: "owner" as const },
    };
    const membersWords = {
      reason: "provider",
      message: `${card} uses GPT Image 2, but you have no access to an OpenAI key; ask the studio's owner.`,
    };
    const ownersWords = {
      reason: "provider",
      message: `${card} uses GPT Image 2, but OpenAI has no API key: add one in Settings → Providers.`,
    };
    const made = () =>
      Promise.all([
        db.generationJob.count({ where: { makerId, projectId, cardId: card } }),
        db.generationBatch.count({ where: { makerId, projectId } }),
      ]);
    const before = await made();
    mode.current = "live";
    keys.present = false;
    try {
      await expect(
        estimateProjectCards(member, projectId, [card]),
      ).rejects.toMatchObject(membersWords);
      await expect(
        enqueueProjectCards(member, { projectId, cardIds: [card] }),
      ).rejects.toMatchObject(membersWords);
      for (const reader of [owner, { id: makerId }]) {
        await expect(
          estimateProjectCards(reader, projectId, [card]),
        ).rejects.toMatchObject(ownersWords);
        await expect(
          enqueueProjectCards(reader, { projectId, cardIds: [card] }),
        ).rejects.toMatchObject(ownersWords);
      }
    } finally {
      keys.present = true;
      mode.current = "queue-member";
    }
    expect(await made()).toEqual(before);
  });

  // A token, a script or the worker hands down { id } alone.
  it("a batch queued with the maker's id alone is queued, with no person", async () => {
    const queued = await enqueueProjectCards(
      { id: makerId },
      { projectId, cardIds: ["recipe-line-art-1"] },
    );
    expect(queued.queued).toBe(1);
    const jobs = await jobsOf(queued.batchId);
    expect(jobs.map((j) => j.memberId)).toEqual([null]);
  });
});

// A studio with several keys: a live batch whose card's provider has no key
// for the reader is refused in the sentence of the reader's case, and nothing
// is queued. Three studios of the shared fixture (Ana owns, Bob and Carla
// work with her): no OpenAI key at all; only Bob's; a team key that cannot be
// read. The reach is read from each studio's own rows.
describe.skipIf(!enabled)(
  "a batch refused by the reader's reach (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const repo = await import("@/server/project-repository");
    const { enqueueProjectCards, estimateProjectCards } = await import(
      "@/server/generation-queue"
    );
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    type Studio = Awaited<ReturnType<typeof fx.openStudio>>;
    type Ref = Parameters<typeof enqueueProjectCards>[0];

    const card = "recipe-line-art-0";
    const editor = lineArtDesign("Queue reach design", [
      lineArtDrawing(0, "Outline"),
    ]);
    const studios: { studio: Studio; projectId: string }[] = [];
    let none: (typeof studios)[number];
    let given: (typeof studios)[number];
    let unreadable: (typeof studios)[number];

    const open = async (label: string) => {
      const studio = await fx.openStudio(label);
      const projectId = await repo.saveProject({ id: studio.makerId }, editor);
      const made = { studio, projectId };
      studios.push(made);
      return made;
    };

    beforeAll(async () => {
      none = await open("queue-reach-none");
      given = await open("queue-reach-given");
      await fx.writeKey(given.studio, {
        provider: "openai",
        name: "Bob's key",
        secret: "sk-fixture-queue-reach-bob-00001",
        people: [given.studio.bob],
      });
      unreadable = await open("queue-reach-unreadable");
      await fx.writeKey(unreadable.studio, {
        provider: "openai",
        name: "Team key",
        forTeam: true,
        secret: "sk-fixture-queue-reach-team-0002",
        unreadable: true,
      });
    });

    afterAll(async () => {
      for (const { studio } of studios) await fx.closeStudio(studio);
    });

    // The reader is refused with `message` on the estimate and on the queue,
    // and the studio gets no job and no batch.
    const refusedWith = async (
      { studio, projectId }: (typeof studios)[number],
      reader: Ref,
      message: string,
    ) => {
      const made = () =>
        Promise.all([
          db.generationJob.count({ where: { makerId: studio.makerId } }),
          db.generationBatch.count({ where: { makerId: studio.makerId } }),
        ]);
      const before = await made();
      mode.current = "live";
      keys.present = false;
      try {
        const words = { reason: "provider", message };
        await expect(
          estimateProjectCards(reader, projectId, [card]),
        ).rejects.toMatchObject(words);
        await expect(
          enqueueProjectCards(reader, { projectId, cardIds: [card] }),
        ).rejects.toMatchObject(words);
      } finally {
        keys.present = true;
        mode.current = "queue-member";
      }
      expect(await made()).toEqual(before);
    };

    it("with no OpenAI key in the studio, the owner, a token and a member read the sentences of before, byte for byte", async () => {
      const { studio } = none;
      for (const reader of [studio.as(studio.ana), studio.as()]) {
        await refusedWith(
          none,
          reader,
          `${card} uses GPT Image 2, but OpenAI has no API key: add one in Settings → Providers.`,
        );
      }
      await refusedWith(
        none,
        studio.as(studio.carla),
        `${card} uses GPT Image 2, but you have no access to an OpenAI key; ask Ana.`,
      );
    });

    it("when the only OpenAI key is Bob's, the owner reads that none is hers or the team's", async () => {
      const { studio } = given;
      await refusedWith(
        given,
        studio.as(studio.ana),
        `${card} uses GPT Image 2, but no OpenAI key is yours or the team's: add one in Settings → Providers.`,
      );
    });

    it("when the only OpenAI key is Bob's, a token reads that the team has none, the only one it runs on", async () => {
      const { studio } = given;
      await refusedWith(
        given,
        studio.as(),
        `${card} uses GPT Image 2, but OpenAI has no key for the whole team, the only one a token runs on: add one in Settings → Providers.`,
      );
    });

    it("when the only OpenAI key is Bob's, Carla reads whom to ask, as before", async () => {
      const { studio } = given;
      await refusedWith(
        given,
        studio.as(studio.carla),
        `${card} uses GPT Image 2, but you have no access to an OpenAI key; ask Ana.`,
      );
    });

    it("when the team key cannot be read, the owner and a token read that, and a member whom to ask", async () => {
      const { studio } = unreadable;
      await refusedWith(
        unreadable,
        studio.as(studio.ana),
        `${card} uses GPT Image 2, but the OpenAI key your calls run on cannot be read: replace it in Settings → Providers.`,
      );
      await refusedWith(
        unreadable,
        studio.as(),
        `${card} uses GPT Image 2, but the team's OpenAI key cannot be read: replace it in Settings → Providers.`,
      );
      await refusedWith(
        unreadable,
        studio.as(studio.bob),
        `${card} uses GPT Image 2, but you have no access to an OpenAI key; ask Ana.`,
      );
    });
  },
);
