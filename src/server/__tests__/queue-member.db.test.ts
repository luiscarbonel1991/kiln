import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  lineArtDesign,
  lineArtDrawing,
} from "@/server/__tests__/fixtures/line-art-design";

// enqueueProjectCards against the throwaway Postgres (see
// project-repository.db.test.ts): the maker ref the session hands down
// carries the person working, and every job the batch queues records them.
// Its own maker, a mode no worker claims, and no worker started.
vi.mock("@/providers/keys", () => ({ hasProviderKey: () => true }));
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
