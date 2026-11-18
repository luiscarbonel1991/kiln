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
    // Every queued card is a scene slot of the project's plan ("q.<key>").
    const KEYS = [
      ...["a", "b", "c", "d", "e", "f", "dup", "cx", "cy", "sx", "sy"],
      ...["ra", "rb", "rc", "sa", "sb", "sc"],
      ...["ma", "mb", "mn", "mr"],
    ];
    const plan = {
      destinations: [
        {
          destinationId: "q",
          shotListId: "queue-test",
          slots: KEYS.map((key) => ({ key, label: key, purpose: key })),
        },
      ],
    };
    const job = (key: string, estimateMicros = 100_000) => ({
      cardId: `q.${key}`,
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
          plan,
        },
      });
      projectId = project.id;
      await db.card.createMany({
        data: ["a", "b", "c", "d", "e", "f"].map((k) => card(`q.${k}`)),
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
      expect(second).toMatchObject({ queued: 1, skipped: ["q.a"] });
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
      expect(mock.map((j) => j.cardId)).toEqual(["q.e"]);
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
      const check = {
        status: "passed" as const,
        engine: "fake",
        lines: [{ expected: "205", found: true, how: "read" as const }],
        problems: [],
        notes: [],
        checkedAt: "2026-11-02T10:00:00.000Z",
      };
      expect(
        await repo.completeJob(running.id, token, "https://x/done.png", check),
      ).toBe(true);
      const saved = await db.card.findUniqueOrThrow({
        where: { projectId_cardId: { projectId, cardId: running.cardId } },
      });
      expect(saved.outputs).toEqual(["https://x/done.png"]);
      expect(saved.status).toBe("done");
      const facts = await repo.outputFacts(projectId, ["https://x/done.png"]);
      expect(facts.get("https://x/done.png")?.check).toEqual(check);
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
      expect(running.cardId).toBe("q.cx");
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
        where: { batchId, cardId: "q.sy" },
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
      expect(before.jobs["q.f"].status).toBe("canceled");
      expect(before.cards["q.f"].status).toBe("draft");
      expect(before.budget.capMicros).toBe(1_000_000);
      await repo.enqueueBatch({ ...base(), jobs: [job("f", 10_000)] });
      const after = await repo.projectGenerationState(makerId, projectId);
      expect(after.jobs["q.f"].status).toBe("queued");
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
            cardId: "q.dup",
            mode,
            status: "running",
            maxAttempts: 2,
            estimateMicros: 1,
          },
        }),
      ).rejects.toThrow();
      await db.generationJob.updateMany({
        where: { makerId, cardId: "q.dup" },
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
            provider: "openai",
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

    it("a plan that cannot be read refuses instead of letting every card through", async () => {
      const broken = await db.project.create({
        data: {
          makerId,
          name: "Broken plan",
          type: "listing-kit",
          phase: "generation",
          plan: { destinations: [] },
        },
      });
      await expect(
        repo.enqueueBatch({
          ...base(),
          projectId: broken.id,
          jobs: [job("a")],
        }),
      ).rejects.toMatchObject({ reason: "not-in-plan" });
    });

    it("a queued job whose project is gone reserves nothing, and the sweep cancels it", async () => {
      const gone = await db.project.create({
        data: {
          makerId,
          name: "Gone",
          type: "listing-kit",
          phase: "generation",
          plan,
        },
      });
      const before = (await repo.budget(makerId)).reservedMicros;
      const { batchId } = await repo.enqueueBatch({
        ...base(),
        projectId: gone.id,
        jobs: [job("b", 30_000)],
      });
      expect((await repo.budget(makerId)).reservedMicros).toBe(before + 30_000);
      // The project goes without the delete path (a crash, a manual delete).
      await db.project.delete({ where: { id: gone.id } });
      expect((await repo.budget(makerId)).reservedMicros).toBe(before);
      await repo.requeueExpired("live");
      const orphan = await db.generationJob.findFirstOrThrow({
        where: { batchId },
      });
      expect(orphan.status).toBe("canceled");
    });

    it("a job moves down its route, and its batch's queued jobs on the same model with it", async () => {
      const flash = {
        provider: "google" as const,
        model: "gemini-3.1-flash-image",
      };
      const later = new Date(Date.now() + 3_600_000);
      const batch = await db.generationBatch.create({
        data: {
          makerId,
          projectId,
          mode: "live",
          count: 3,
          estimateMicros: 300_000,
          model: "gpt-image-2",
        },
      });
      const row = (
        key: string,
        data: { status: string } & Record<string, unknown>,
      ) => ({
        batchId: batch.id,
        makerId,
        projectId,
        cardId: `q.${key}`,
        mode: "live",
        maxAttempts: 2,
        request,
        estimateMicros: 100_000,
        // Never claimable by the other tests of this file.
        availableAt: later,
        ...data,
      });
      await db.generationJob.createMany({
        data: [
          row("ra", {
            status: "running",
            attempt: 1,
            leaseToken: "lease-ra",
            callStartedAt: new Date(),
            route: { next: [flash], switched: [] },
          }),
          row("rb", {
            status: "queued",
            route: { next: [flash], switched: [] },
          }),
          row("rc", { status: "queued" }),
        ],
      });
      const byKey = async (key: string) =>
        db.generationJob.findFirstOrThrow({
          where: { batchId: batch.id, cardId: `q.${key}` },
        });
      const ra = await byKey("ra");
      const move = { to: flash, rest: [], reason: "OpenAI answered 503" };
      expect(
        await repo.fallBackJob(
          { id: ra.id, leaseToken: "stale" },
          move,
          () => true,
        ),
      ).toBe(false);
      expect(
        await repo.fallBackJob(
          { id: ra.id, leaseToken: "lease-ra" },
          move,
          () => true,
        ),
      ).toBe(true);

      const moved = await byKey("ra");
      expect(moved).toMatchObject({
        status: "queued",
        leaseToken: null,
        callStartedAt: null,
        // Its attempts counted afresh on the new model.
        attempt: 0,
        maxAttempts: 2,
      });
      expect(moved.request).toMatchObject({
        prompt: "a scene",
        model: {
          provider: "google",
          model: "gemini-3.1-flash-image",
          aspect: "1:1",
        },
      });
      expect(moved.route).toMatchObject({
        next: [],
        switched: [
          {
            from: { provider: "openai", model: "gpt-image-2" },
            to: flash,
            reason: "OpenAI answered 503",
          },
        ],
      });
      const rb = await byKey("rb");
      expect(rb.request).toMatchObject({ model: flash });
      expect(rb.route).toMatchObject({
        next: [],
        switched: [
          { reason: "OpenAI answered 503 (on another frame of the batch)" },
        ],
      });
      // A job with no route stays on its model.
      expect((await byKey("rc")).request).toMatchObject({
        model: { provider: "openai", model: "gpt-image-2" },
      });
      await db.generationJob.updateMany({
        where: { batchId: batch.id },
        data: { status: "canceled", finishedAt: new Date() },
      });
    });

    it("a conversation's paid work: what it spent, and what it holds", async () => {
      const sessionId = `chat-${slug}`;
      const { batchId } = await repo.enqueueBatch({
        ...base(),
        jobs: [job("sa", 10_000), job("sb", 20_000)],
        sessionId,
      });
      const jobs = await db.generationJob.findMany({ where: { batchId } });
      expect(jobs.map((j) => j.sessionId)).toEqual([sessionId, sessionId]);
      expect(await repo.sessionSpend(makerId, sessionId)).toEqual({
        spentMicros: 0,
        queuedMicros: 30_000,
      });

      // A measured cost counts; a call with no answer counts at its estimate.
      const now = new Date();
      await db.generationJob.updateMany({
        where: { batchId, cardId: "q.sa" },
        data: { status: "done", actualMicros: 7_000, finishedAt: now },
      });
      await db.generationJob.updateMany({
        where: { batchId, cardId: "q.sb" },
        data: { status: "failed", callStartedAt: now, finishedAt: now },
      });
      // A direct call (the listing text) holds its estimate until it closes.
      const direct = await repo.reserveDirectCall({
        makerId,
        provider: "openai",
        model: "gpt-6.1-sol",
        estimateMicros: 5_000,
        sessionId,
      });
      expect(await repo.sessionSpend(makerId, sessionId)).toEqual({
        spentMicros: 27_000,
        queuedMicros: 5_000,
      });
      await repo.markDirectCall(direct);
      await repo.closeDirectCall(direct, { usage: {}, actualMicros: 1_000 });

      // A mock run is never paid, and another maker reads nothing of it.
      const mock = await repo.enqueueBatch({
        ...base(),
        mode: "mock",
        jobs: [job("sc", 50_000)],
        sessionId,
      });
      expect(await repo.sessionSpend(makerId, sessionId)).toEqual({
        spentMicros: 28_000,
        queuedMicros: 0,
      });
      expect(await repo.sessionSpend("someone-else", sessionId)).toEqual({
        spentMicros: 0,
        queuedMicros: 0,
      });
      await db.generationJob.updateMany({
        where: { batchId: mock.batchId },
        data: { status: "canceled", finishedAt: new Date() },
      });
    });

    // A batch records the person who queued it; work with no
    // person (a token, a script, the worker) records none and still queues.
    it("a batch queued by a person stores them on every job; one with no person stores null", async () => {
      // A mode no worker claims, so the rows stay as queued.
      const mode = "member-batch" as never;
      const byPerson = await repo.enqueueBatch({
        ...base(),
        mode,
        memberId: "m1",
        jobs: [job("ma", 1), job("mb", 1)],
      });
      const theirs = await db.generationJob.findMany({
        where: { batchId: byPerson.batchId },
      });
      expect(theirs.map((j) => j.memberId)).toEqual(["m1", "m1"]);

      const byNoOne = await repo.enqueueBatch({
        ...base(),
        mode,
        jobs: [job("mn", 1)],
      });
      expect(byNoOne.queued).toBe(1);
      const unnamed = await db.generationJob.findFirstOrThrow({
        where: { batchId: byNoOne.batchId },
      });
      expect(unnamed.memberId).toBeNull();
      await db.generationJob.updateMany({
        where: { batchId: { in: [byPerson.batchId, byNoOne.batchId] } },
        data: { status: "canceled", finishedAt: new Date() },
      });
    });

    // The worker knows whose job it runs, across a retry and a route move.
    it("a claimed job carries who queued it, kept across a retry and a move down its route", async () => {
      const mode = "member-claim" as never;
      const { batchId } = await repo.enqueueBatch({
        ...base(),
        mode,
        memberId: "m1",
        jobs: [job("mr", 1)],
      });
      const [first] = await repo.claimJobs(mode, 1, 60);
      expect(first).toMatchObject({ cardId: "q.mr", memberId: "m1" });

      expect(
        await repo.failJob(first.id, first.leaseToken, "503", {
          retry: true,
          mayBeCharged: false,
        }),
      ).toBe(true);
      // Skip the retry's backoff.
      await db.generationJob.update({
        where: { id: first.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      const [retried] = await repo.claimJobs(mode, 1, 60);
      expect(retried).toMatchObject({
        id: first.id,
        attempt: 2,
        memberId: "m1",
      });

      const flash = {
        provider: "google" as const,
        model: "gemini-3.1-flash-image",
      };
      expect(
        await repo.fallBackJob(
          { id: retried.id, leaseToken: retried.leaseToken },
          { to: flash, rest: [], reason: "OpenAI answered 503" },
          () => true,
        ),
      ).toBe(true);
      const [moved] = await repo.claimJobs(mode, 1, 60);
      expect(moved).toMatchObject({ id: first.id, memberId: "m1" });
      await db.generationJob.updateMany({
        where: { batchId },
        data: { status: "canceled", finishedAt: new Date() },
      });
    });

    // A direct call and a key check record the person who made
    // them, or no one.
    it("a direct call and a key check store who made them, or null", async () => {
      const solo = await db.maker.create({
        data: {
          slug: `${slug}-direct-member`,
          name: "Direct member test",
          monthlyCapCents: 100,
        },
      });
      try {
        const reserve = (memberId?: string) =>
          repo.reserveDirectCall({
            makerId: solo.id,
            provider: "openai",
            model: "gpt-image-2",
            estimateMicros: 1_000,
            ...(memberId ? { memberId } : {}),
          });
        const theirs = await reserve("m1");
        const nobody = await reserve();
        await repo.recordKeyCheck({
          makerId: solo.id,
          provider: "google",
          error: null,
          memberId: "m1",
        });
        await repo.recordKeyCheck({
          makerId: solo.id,
          provider: "openai",
          error: null,
        });
        const rows = await db.generationJob.findMany({
          where: { makerId: solo.id },
        });
        const byId = new Map(rows.map((r) => [r.id, r.memberId]));
        expect(byId.get(theirs)).toBe("m1");
        expect(byId.get(nobody)).toBeNull();
        const checks = rows.filter((r) => r.cardId === "key-check");
        expect(
          checks
            .map((r) => [
              (r.request as { provider: string }).provider,
              r.memberId,
            ])
            .sort(),
        ).toEqual([
          ["google", "m1"],
          ["openai", null],
        ]);
      } finally {
        await db.generationJob.deleteMany({ where: { makerId: solo.id } });
        await db.maker.delete({ where: { id: solo.id } });
      }
    });

    // The month's spend per person, by the cap's own rule; its rows
    // add up to what the budget counts as spent.
    it("the month's spend per person adds up to the budget's spent, by the cap's rule", async () => {
      const solo = await db.maker.create({
        data: {
          slug: `${slug}-by-member`,
          name: "Spend by member test",
          monthlyCapCents: 100_000,
        },
      });
      const now = new Date();
      const lastMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
      );
      const row = (
        memberId: string | null,
        data: { status: string } & Record<string, unknown>,
      ) => ({
        makerId: solo.id,
        memberId,
        cardId: "direct",
        mode: "live",
        maxAttempts: 1,
        estimateMicros: 5_000,
        ...data,
      });
      try {
        await db.generationJob.createMany({
          data: [
            // m1: a measured cost, and a call with no answer at its estimate.
            row("m1", { status: "done", actualMicros: 7_000, finishedAt: now }),
            row("m1", {
              status: "failed",
              callStartedAt: now,
              finishedAt: now,
            }),
            // Not spent: a failure before the call, queued and running work,
            // a mock run, last month.
            row("m1", { status: "failed", finishedAt: now }),
            row("m1", { status: "running", startedAt: now }),
            row("m2", { status: "queued" }),
            row("m1", {
              status: "done",
              mode: "mock",
              actualMicros: 99_000,
              finishedAt: now,
            }),
            row("m2", {
              status: "done",
              actualMicros: 50_000,
              finishedAt: lastMonth,
            }),
            row("m2", { status: "done", actualMicros: 3_000, finishedAt: now }),
            row(null, { status: "done", actualMicros: 800, finishedAt: now }),
            // A free key check: a person with nothing spent has no row.
            row("m3", { status: "done", actualMicros: 0, finishedAt: now }),
          ],
        });
        const maker = { id: solo.id };
        const [rows, budget] = await Promise.all([
          repo.spendByMember(maker),
          repo.budget(solo.id),
        ]);
        expect(rows).toEqual([
          { memberId: "m1", spentMicros: 12_000 },
          { memberId: "m2", spentMicros: 3_000 },
          { memberId: null, spentMicros: 800 },
        ]);
        expect(rows.reduce((sum, r) => sum + r.spentMicros, 0)).toBe(
          budget.spentMicros,
        );
        // A member's read is filtered in SQL to their own sum.
        expect(await repo.spendByMember(maker, { memberId: "m2" })).toEqual([
          { memberId: "m2", spentMicros: 3_000 },
        ]);
        // Another maker reads none of it.
        expect(await repo.spendByMember({ id: "someone-else" })).toEqual([]);
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
