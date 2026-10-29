import { afterAll, describe, expect, it } from "vitest";

// What a project spent, card by card, under the budget's rule (the throwaway
// Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("projectSpend (database)", async () => {
  const { db } = await import("@/lib/db");
  const { closeDirectCall, projectSpend, reserveDirectCall } = await import(
    "@/server/generation-repository"
  );
  const { getCurrentMaker } = await import("@/server/maker-repository");

  const created: string[] = [];
  afterAll(async () => {
    await db.generationJob.deleteMany({
      where: { projectId: { in: created } },
    });
    await db.project.deleteMany({ where: { id: { in: created } } });
  });

  it("counts every live take of a card, measured or at its estimate once called, and the direct calls apart", async () => {
    const maker = await getCurrentMaker();
    const project = await db.project.create({
      data: {
        makerId: maker.id,
        name: "Cost test",
        type: "listing-kit",
        phase: "generation",
      },
    });
    created.push(project.id);
    const job = (over: Record<string, unknown>) =>
      db.generationJob.create({
        data: {
          makerId: maker.id,
          projectId: project.id,
          cardId: "etsy.hero",
          mode: "live",
          status: "done",
          maxAttempts: 2,
          estimateMicros: 70_000,
          ...over,
        },
      });
    // Two takes of the hero, both measured.
    await job({ actualMicros: 61_000, outputUrl: "https://x/1.png" });
    await job({ actualMicros: 59_000, outputUrl: "https://x/2.png" });
    // A timed-out call: no measure, counted at its estimate; no take.
    await job({ status: "failed", callStartedAt: new Date() });
    // Refused before any call: nothing counts.
    await job({ status: "failed" });
    // Still queued: not spent yet.
    await job({ cardId: "etsy.in-use", status: "queued" });
    // A mock run never counts.
    await job({
      mode: "mock",
      actualMicros: 61_000,
      outputUrl: "https://x/m.png",
    });
    // The listing text, a direct call made for this project.
    await job({ cardId: "direct", actualMicros: 4_000 });

    // A text call reserved for the project (writeListing passes its id).
    const direct = await reserveDirectCall({
      makerId: maker.id,
      provider: "openai",
      model: "gpt-6.1-sol",
      estimateMicros: 38_000,
      projectId: project.id,
    });
    await closeDirectCall(direct, { usage: null, actualMicros: 3_000 });

    const spend = await projectSpend(project.id);
    expect(spend.byCard.get("etsy.hero")).toEqual({
      spentMicros: 61_000 + 59_000 + 70_000,
      takes: 2,
    });
    expect(spend.byCard.has("etsy.in-use")).toBe(false);
    expect(spend.directMicros).toBe(4_000 + 3_000);
  });
});
