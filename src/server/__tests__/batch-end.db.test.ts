import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("a batch that ends (database)", async () => {
  const { db } = await import("@/lib/db");
  const queue = await import("@/server/generation-repository");
  const chats = await import("@/server/chat/chat-repository");
  const { batchWords } = await import("@/server/batch-end");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  let maker: { id: string };
  let project: { id: string };
  let session: { id: string };

  beforeAll(async () => {
    maker = await getCurrentMaker();
    project = await db.project.create({
      data: {
        makerId: maker.id,
        name: "Batch end test",
        type: "listing-kit",
        phase: "generation",
      },
    });
    session = await chats.createChatSession(maker, project.id);
  });

  afterAll(async () => {
    await db.generationBatch.deleteMany({ where: { projectId: project.id } });
    await db.chatSession.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
  });

  // A batch of running jobs, each with its lease token.
  async function batchOf(cards: string[]) {
    const batch = await db.generationBatch.create({
      data: {
        makerId: maker.id,
        projectId: project.id,
        mode: "live",
        count: cards.length,
        estimateMicros: 1,
        model: "gpt-image-2",
      },
    });
    const jobs = [];
    for (const cardId of cards) {
      jobs.push(
        await db.generationJob.create({
          data: {
            batchId: batch.id,
            makerId: maker.id,
            projectId: project.id,
            cardId,
            mode: "live",
            status: "running",
            maxAttempts: 2,
            estimateMicros: 1,
            leaseToken: `lease-${cardId}`,
            leaseUntil: new Date(Date.now() + 60_000),
          },
        }),
      );
    }
    return { batch, jobs };
  }

  const notices = async () =>
    ((await chats.getChat(maker, session.id))?.messages ?? []).filter((m) =>
      m.id.startsWith("event-"),
    );

  it("is marked once, when its last job ends, and its project's chat hears it", async () => {
    const { batch, jobs } = await batchOf(["etsy.a", "etsy.b"]);
    await queue.completeJob(jobs[0].id, "lease-etsy.a", "https://x/a.png");
    expect(await notices()).toEqual([]);
    await queue.failJob(jobs[1].id, "lease-etsy.b", "OpenAI is down", {
      retry: false,
      mayBeCharged: false,
    });
    const heard = await notices();
    expect(heard).toHaveLength(1);
    expect(heard[0].parts[0]).toEqual({
      type: "data-kiln-event",
      data: { text: "1 of 2 frames of the last batch landed, 1 failed." },
    });
    const row = await db.generationBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    expect(row.finishedAt).not.toBeNull();
  });

  it("a job sent back to the queue does not end its batch", async () => {
    const before = (await notices()).length;
    const { jobs } = await batchOf(["etsy.c"]);
    await queue.failJob(jobs[0].id, "lease-etsy.c", "rate limited", {
      retry: true,
      mayBeCharged: false,
    });
    expect(await notices()).toHaveLength(before);
  });

  it("says it in words", () => {
    const end = { projectId: "p", count: 5, done: 5, failed: 0, canceled: 0 };
    expect(batchWords(end)).toBe(
      "All 5 frames of the last batch landed: they wait for review on the board.",
    );
    expect(batchWords({ ...end, count: 1, done: 1 })).toBe(
      "The frame of the last batch landed: it waits for review on the board.",
    );
    expect(batchWords({ ...end, done: 3, canceled: 2 })).toBe(
      "3 of 5 frames of the last batch landed, 2 canceled.",
    );
  });
});
