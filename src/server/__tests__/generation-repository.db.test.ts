import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against a real, throwaway Postgres (see
// project-repository.db.test.ts for the setup). Its own maker, so it never
// touches another test's spend or cap.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "generation queue repository (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const repo = await import("@/server/generation-repository");

    const slug = `queue-test-${Date.now()}`;
    let makerId = "";
    let projectId = "";
    const request = {
      kind: "image" as const,
      masterAssetUrl: "https://stub.local/plate.png",
      prompt: "a scene",
      imageInputs: [],
      negative: "",
      model: {
        provider: "openai" as const,
        model: "gpt-image-2",
        aspect: "1:1",
        guidance: 7.5,
        strength: 0.65,
      },
    };
    const job = (cardId: string, estimateMicros = 100_000) => ({
      cardId,
      request,
      estimateMicros,
    });
    const card = (cardId: string) => ({
      projectId,
      cardId,
      masterAssetId: "m",
      recipeId: "etsy-listing@etsy",
      type: "image",
      direction: cardId,
      fields: {},
      references: [],
      model: request.model,
      outputs: [],
      status: "draft",
      sortOrder: 0,
    });

    beforeAll(async () => {
      const maker = await db.maker.create({
        data: { slug, name: "Queue test", monthlyCapCents: 100 },
      });
      makerId = maker.id;
      const project = await db.project.create({
        data: {
          makerId,
          name: "Queue test",
          type: "listing-kit",
          phase: "generation",
          plan: { destinations: [] },
        },
      });
      projectId = project.id;
      await db.card.createMany({
        data: ["a", "b", "c", "d", "e", "f"].map(card),
      });
    });

    afterAll(async () => {
      await db.generationJob.deleteMany({ where: { makerId } });
      await db.generationBatch.deleteMany({ where: { makerId } });
      await db.project.deleteMany({ where: { makerId } });
      await db.maker.delete({ where: { id: makerId } });
    });

    const base = () => ({
      makerId,
      projectId,
      mode: "live" as const,
      model: "gpt-image-2",
    });

    it("queues a batch; a card already in the queue is skipped, not queued twice", async () => {
      const first = await repo.enqueueBatch({ ...base(), jobs: [job("a")] });
      expect(first.queued).toBe(1);
      const second = await repo.enqueueBatch({
        ...base(),
        jobs: [job("a"), job("b")],
      });
      expect(second).toMatchObject({ queued: 1, skipped: ["a"] });
      await expect(
        repo.enqueueBatch({ ...base(), jobs: [job("b")] }),
      ).rejects.toMatchObject({ reason: "already-queued" });
    });

    it("refuses when the server's estimate exceeds the one shown", async () => {
      await expect(
        repo.enqueueBatch({
          ...base(),
          jobs: [job("c", 50_000)],
          shownMaxMicros: 40_000,
        }),
      ).rejects.toMatchObject({ reason: "estimate-changed" });
    });

    it("two enqueues racing at the cap: exactly one fits", async () => {
      // Cap $1.00; a and b reserve $0.20, so $0.80 is left: one $0.50 batch fits.
      const results = await Promise.allSettled([
        repo.enqueueBatch({ ...base(), jobs: [job("c", 500_000)] }),
        repo.enqueueBatch({ ...base(), jobs: [job("d", 500_000)] }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected");
      expect(refused?.status === "rejected" && refused.reason.reason).toBe(
        "cap",
      );
    });

    it("mock batches skip the cap and a mock worker never claims live jobs", async () => {
      await repo.enqueueBatch({
        ...base(),
        mode: "mock",
        jobs: [job("e", 5_000_000)],
      });
      const mock = await repo.claimJobs("mock", 10, 60);
      expect(mock.map((j) => j.cardId)).toEqual(["e"]);
      expect(
        await repo.completeJob(
          mock[0].id,
          mock[0].leaseToken,
          "https://stub.local/e.png",
        ),
      ).toBe(true);
    });

    it("concurrent claims never take the same job", async () => {
      const [x, y] = await Promise.all([
        repo.claimJobs("live", 1, 60),
        repo.claimJobs("live", 1, 60),
      ]);
      const ids = [...x, ...y].map((j) => j.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("a stale lease writes nothing, but its cost is still recorded", async () => {
      const running = await db.generationJob.findFirstOrThrow({
        where: { makerId, status: "running", mode: "live" },
      });
      expect(
        await repo.completeJob(running.id, "stale-token", "https://x/1.png"),
      ).toBe(false);
      await repo.recordCost(running.id, { outputTokens: 10 }, 123);
      const after = await db.generationJob.findUniqueOrThrow({
        where: { id: running.id },
      });
      expect(after.status).toBe("running");
      expect(after.actualMicros).toBe(123);
    });

    it("completing puts the output on the card in the same transaction", async () => {
      const running = await db.generationJob.findFirstOrThrow({
        where: { makerId, status: "running", mode: "live" },
      });
      const token = running.leaseToken ?? "";
      expect(
        await repo.completeJob(running.id, token, "https://x/done.png"),
      ).toBe(true);
      const saved = await db.card.findUniqueOrThrow({
        where: { projectId_cardId: { projectId, cardId: running.cardId } },
      });
      expect(saved.outputs).toEqual(["https://x/done.png"]);
      expect(saved.status).toBe("done");
    });

    it("a retried failure waits out its backoff; an expired lease follows the retry rule", async () => {
      const [claimed] = await repo.claimJobs("live", 1, 60);
      expect(
        await repo.failJob(claimed.id, claimed.leaseToken, "503", {
          retry: true,
          mayBeCharged: false,
        }),
      ).toBe(true);
      expect(await repo.claimJobs("live", 1, 60)).toEqual([]);

      await db.generationJob.update({
        where: { id: claimed.id },
        data: {
          status: "running",
          attempt: 2,
          leaseToken: "dead",
          leaseUntil: new Date(Date.now() - 1000),
        },
      });
      expect(await repo.requeueExpired("live")).toBe(1);
      const failed = await db.generationJob.findUniqueOrThrow({
        where: { id: claimed.id },
      });
      expect(failed.status).toBe("failed");
    });

    it("a job whose worker died during its paid call is never requeued, and counts at its estimate", async () => {
      const before = await repo.budget(makerId);
      const dead = {
        makerId,
        projectId,
        mode: "live",
        status: "running",
        attempt: 1,
        maxAttempts: 2,
        leaseToken: "dead",
        leaseUntil: new Date(Date.now() - 1000),
        startedAt: new Date(),
      };
      const during = await db.generationJob.create({
        data: {
          ...dead,
          cardId: "died-during",
          estimateMicros: 70_000,
          callStartedAt: new Date(),
        },
      });
      const early = await db.generationJob.create({
        data: { ...dead, cardId: "died-before", estimateMicros: 1 },
      });
      expect(await repo.requeueExpired("live")).toBe(2);
      const failed = await db.generationJob.findUniqueOrThrow({
        where: { id: during.id },
      });
      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("may have been charged");
      const requeued = await db.generationJob.findUniqueOrThrow({
        where: { id: early.id },
      });
      expect(requeued.status).toBe("queued");
      await db.generationJob.delete({ where: { id: early.id } });
      const after = await repo.budget(makerId);
      expect(after.spentMicros - before.spentMicros).toBe(70_000);
    });

    it("recordCost adds to what the job recorded, never overwrites it", async () => {
      const job = await db.generationJob.create({
        data: {
          makerId,
          projectId,
          cardId: "cost",
          mode: "mock",
          status: "done",
          maxAttempts: 2,
          estimateMicros: 1,
        },
      });
      await repo.recordCost(job.id, { outputTokens: 1 }, 100);
      await repo.recordCost(job.id, { outputTokens: 2 }, 50);
      const after = await db.generationJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(after.actualMicros).toBe(150);
      expect(after.usage).toEqual({ outputTokens: 2 });
    });

    it("cancel stops what has not started", async () => {
      const { batchId } = await repo.enqueueBatch({
        ...base(),
        jobs: [job("f", 10_000)],
      });
      expect(await repo.cancelBatch(makerId, batchId)).toBe(1);
      const f = await db.generationJob.findFirstOrThrow({
        where: { batchId },
      });
      expect(f.status).toBe("canceled");
    });

    it("a canceled batch never pays: no claim, no call mark, no retry", async () => {
      // A mode no other test claims, so only these rows are in play.
      const mode = "cancel-test" as never;
      const { batchId } = await repo.enqueueBatch({
        ...base(),
        mode,
        jobs: [job("cx", 1), job("cy", 1)],
      });
      const [running] = await repo.claimJobs(mode, 1, 60);
      expect(running.cardId).toBe("cx");
      // Only the queued job is canceled; the running one finishes.
      expect(await repo.cancelBatch(makerId, batchId)).toBe(1);
      expect(await repo.markCallStarted(running.id, running.leaseToken)).toBe(
        false,
      );
      expect(
        await repo.failJob(running.id, running.leaseToken, "503", {
          retry: true,
          mayBeCharged: false,
        }),
      ).toBe(true);
      const after = await db.generationJob.findUniqueOrThrow({
        where: { id: running.id },
      });
      expect(after.status).toBe("canceled");
      expect(after.finishedAt).not.toBeNull();
      expect(await repo.claimJobs(mode, 10, 60)).toEqual([]);
    });

    it("the sweep cancels a canceled batch's expired and leftover jobs", async () => {
      const mode = "cancel-sweep" as never;
      const { batchId } = await repo.enqueueBatch({
        ...base(),
        mode,
        jobs: [job("sx", 1), job("sy", 1)],
      });
      const [running] = await repo.claimJobs(mode, 1, 60);
      await repo.cancelBatch(makerId, batchId);
      // A retry that slipped past the cancel, and a worker that died.
      await db.generationJob.updateMany({
        where: { batchId, cardId: "sy" },
        data: { status: "queued" },
      });
      await db.generationJob.update({
        where: { id: running.id },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      });
      expect(await repo.requeueExpired(mode)).toBe(1);
      const jobs = await db.generationJob.findMany({ where: { batchId } });
      expect(jobs.map((j) => j.status).sort()).toEqual([
        "canceled",
        "canceled",
      ]);
    });

    it("the polled state carries each card's latest job, the budget and a changing version", async () => {
      const before = await repo.projectGenerationState(makerId, projectId);
      expect(before.jobs.f.status).toBe("canceled");
      expect(before.cards.f.status).toBe("draft");
      expect(before.budget.capMicros).toBe(1_000_000);
      await repo.enqueueBatch({ ...base(), jobs: [job("f", 10_000)] });
      const after = await repo.projectGenerationState(makerId, projectId);
      expect(after.jobs.f.status).toBe("queued");
      expect(after.batch?.queued).toBe(1);
      expect(after.version).not.toBe(before.version);
    });

    it("a card asked for twice is queued once, and the index refuses a second active job", async () => {
      // A mode no other test claims, so no worker picks these rows up.
      const mode = "dup-test" as never;
      const { queued } = await repo.enqueueBatch({
        ...base(),
        mode,
        jobs: [job("dup", 1), job("dup", 1)],
      });
      expect(queued).toBe(1);
      await expect(
        db.generationJob.create({
          data: {
            makerId,
            projectId,
            cardId: "dup",
            mode,
            status: "running",
            maxAttempts: 2,
            estimateMicros: 1,
          },
        }),
      ).rejects.toThrow();
      await db.generationJob.updateMany({
        where: { makerId, cardId: "dup" },
        data: { status: "canceled" },
      });
    });

    it("direct calls reserve against the cap: two at the limit, one passes", async () => {
      const solo = await db.maker.create({
        data: {
          slug: `${slug}-direct`,
          name: "Direct test",
          monthlyCapCents: 10,
        },
      });
      try {
        const reserve = () =>
          repo.reserveDirectCall({
            makerId: solo.id,
            model: "gpt-image-2",
            estimateMicros: 60_000,
          });
        const results = await Promise.allSettled([reserve(), reserve()]);
        const passed = results.find((r) => r.status === "fulfilled");
        const refused = results.find((r) => r.status === "rejected");
        expect(refused?.status === "rejected" && refused.reason.reason).toBe(
          "cap",
        );
        const id = passed?.status === "fulfilled" ? passed.value : "";
        expect((await repo.budget(solo.id)).reservedMicros).toBe(60_000);

        await repo.markDirectCall(id);
        await repo.closeDirectCall(id, {
          usage: { outputTokens: 1 },
          actualMicros: 20_000,
        });
        const paid = await repo.budget(solo.id);
        expect(paid).toMatchObject({ spentMicros: 20_000, reservedMicros: 0 });

        // An error the provider answered counts nothing; no answer counts at
        // the estimate.
        const answered = await reserve();
        await repo.markDirectCall(answered);
        await repo.closeDirectCall(answered, {
          error: "429",
          mayBeCharged: false,
        });
        expect((await repo.budget(solo.id)).spentMicros).toBe(20_000);
        const unanswered = await reserve();
        await repo.markDirectCall(unanswered);
        await repo.closeDirectCall(unanswered, {
          error: "timeout",
          mayBeCharged: true,
        });
        expect((await repo.budget(solo.id)).spentMicros).toBe(80_000);
      } finally {
        await db.generationJob.deleteMany({ where: { makerId: solo.id } });
        await db.maker.delete({ where: { id: solo.id } });
      }
    });

    it("deleting the project keeps the month's spend", async () => {
      const spentBefore = (await repo.budget(makerId)).spentMicros;
      expect(spentBefore).toBeGreaterThan(0);
      await db.project.delete({ where: { id: projectId } });
      expect((await repo.budget(makerId)).spentMicros).toBe(spentBefore);
    });
  },
);
