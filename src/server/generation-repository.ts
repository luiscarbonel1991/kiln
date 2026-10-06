import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { canAfford } from "@/domain/generation-cost";
import { GenerationRequest } from "@/domain/generation-request";
import { modelLabel } from "@/domain/model-defaults";
import { generableCardIds, ProjectPlan } from "@/domain/plan";
import {
  ACTIVE_JOB_STATUSES,
  type JobStatus,
  type JobView,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from "@/domain/queue";
import { assertDatabaseUrl, db } from "@/lib/db";

// Persistence for the background generation queue. Every closing write on a
// job is guarded by its lease token, so a worker that lost its lease (another
// process requeued it) changes nothing — except the cost it already incurred,
// which is always recorded. A job pays for at most one call: "callStartedAt"
// is stamped under the lease right before the paid request, and a job with it
// set is never requeued; finished without a measured cost, it counts at its
// estimate. A job whose batch was canceled, or whose project was deleted,
// never starts a call and is never requeued. Money is in micro-dollars.

export type ProviderMode = "live" | "mock";

export class QueueRefusal extends Error {
  constructor(
    readonly reason:
      | "cap"
      | "estimate-changed"
      | "already-queued"
      | "not-in-plan"
      | "needs-scene"
      | "model"
      | "provider",
    message: string,
  ) {
    super(message);
    this.name = "QueueRefusal";
  }
}

export interface NewJob {
  cardId: string;
  request: GenerationRequest;
  estimateMicros: number;
}

export interface ClaimedJob {
  id: string;
  leaseToken: string;
  attempt: number;
  maxAttempts: number;
  makerId: string;
  projectId: string | null;
  cardId: string;
  request: unknown;
  estimateMicros: number;
}

export interface Budget {
  spentMicros: number;
  reservedMicros: number;
  capMicros: number;
}

const CENT_MICROS = 10_000;

// A queue job that must not start again: its batch was canceled, or its
// project deleted (the job outlives it with projectId NULL). Direct calls have
// no batch and are never stopped.
const STOPPED = Prisma.sql`(
  (j."batchId" IS NOT NULL AND j."projectId" IS NULL)
  OR EXISTS (
    SELECT 1 FROM "GenerationBatch" b
    WHERE b."id" = j."batchId" AND b."canceledAt" IS NOT NULL))`;

type Tx = Prisma.TransactionClient;

// What this calendar month (UTC) has spent on live generations, and what live
// jobs in the queue have reserved (their recorded cost, else their estimate);
// a queued job whose project is gone reserves nothing (it is never claimed).
// A finished job counts its measured cost; without one, its estimate if its
// paid call went out (the outcome is unknown), else nothing. One statement, so
// a job moving to done mid-read is counted exactly once.
async function spend(
  tx: Tx | typeof db,
  makerId: string,
): Promise<{ spentMicros: number; reservedMicros: number }> {
  const [row] = await tx.$queryRaw<{ spent: number; reserved: number }[]>`
    SELECT
      COALESCE(SUM(CASE
        WHEN "status" IN ('done', 'failed', 'canceled')
          AND "finishedAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        THEN COALESCE("actualMicros", CASE WHEN "callStartedAt" IS NOT NULL THEN "estimateMicros" ELSE 0 END)
        ELSE 0 END), 0)::float8 AS "spent",
      COALESCE(SUM(CASE
        WHEN "status" = 'running'
          OR ("status" = 'queued' AND "projectId" IS NOT NULL)
        THEN COALESCE("actualMicros", "estimateMicros")
        ELSE 0 END), 0)::float8 AS "reserved"
    FROM "GenerationJob"
    WHERE "makerId" = ${makerId} AND "mode" = 'live'`;
  return { spentMicros: row.spent, reservedMicros: row.reserved };
}

export async function budget(makerId: string): Promise<Budget> {
  assertDatabaseUrl();
  const maker = await db.maker.findUniqueOrThrow({
    where: { id: makerId },
    select: { monthlyCapCents: true },
  });
  return {
    ...(await spend(db, makerId)),
    capMicros: maker.monthlyCapCents * CENT_MICROS,
  };
}

// Queue an approved batch. The maker row is locked for the whole check-and-
// insert, so concurrent enqueues (two tabs, the board and an editor) are
// serialized: one cap check sees the other's reservation, and a card already
// queued or running — or asked for twice in this batch — is queued once (a
// partial unique index backs this). A live batch must fit the monthly cap;
// the server's estimate may not exceed what the maker was shown.
export async function enqueueBatch(input: {
  makerId: string;
  projectId: string;
  mode: ProviderMode;
  model: string;
  jobs: NewJob[];
  shownMaxMicros?: number;
}): Promise<{ batchId: string; queued: number; skipped: string[] }> {
  assertDatabaseUrl();
  const { makerId, projectId, mode } = input;
  return db.$transaction(async (tx) => {
    const [maker] = await tx.$queryRaw<{ cap: number }[]>`
      SELECT "monthlyCapCents"::int AS "cap" FROM "Maker"
      WHERE "id" = ${makerId} FOR UPDATE`;
    if (!maker) throw new Error("maker not found");
    // The project row too (setSlotOff and approvals take it): a planned
    // project generates only its scene slots that are switched on.
    const [project] = await tx.$queryRaw<{ plan: unknown }[]>`
      SELECT "plan" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${makerId} FOR UPDATE`;
    if (!project) throw new Error("project not found");
    const plan = ProjectPlan.safeParse(project.plan);
    if (!plan.success) {
      throw new QueueRefusal(
        "not-in-plan",
        "The project's plan could not be read, so nothing was queued.",
      );
    }
    const allowed = new Set(generableCardIds(plan.data));
    if (input.jobs.some((j) => !allowed.has(j.cardId))) {
      throw new QueueRefusal(
        "not-in-plan",
        "Only the scenes switched on in the plan can be generated.",
      );
    }
    const busy = new Set(
      (
        await tx.generationJob.findMany({
          where: {
            projectId,
            cardId: { in: input.jobs.map((j) => j.cardId) },
            status: { in: ACTIVE_JOB_STATUSES },
          },
          select: { cardId: true },
        })
      ).map((j) => j.cardId),
    );
    const seen = new Set<string>();
    const fresh = input.jobs.filter((j) => {
      if (busy.has(j.cardId) || seen.has(j.cardId)) return false;
      seen.add(j.cardId);
      return true;
    });
    if (fresh.length === 0) {
      throw new QueueRefusal(
        "already-queued",
        "Every scene asked for is already in the queue.",
      );
    }
    const total = fresh.reduce((t, j) => t + j.estimateMicros, 0);
    if (input.shownMaxMicros !== undefined && total > input.shownMaxMicros) {
      throw new QueueRefusal(
        "estimate-changed",
        "The estimate changed since it was shown; review it again.",
      );
    }
    if (mode === "live") {
      const used = await spend(tx, makerId);
      const capMicros = maker.cap * CENT_MICROS;
      if (!canAfford({ ...used, requestMicros: total, capMicros })) {
        throw new QueueRefusal(
          "cap",
          "This batch would go over this month's spending cap.",
        );
      }
    }
    const batch = await tx.generationBatch.create({
      data: {
        makerId,
        projectId,
        mode,
        count: fresh.length,
        estimateMicros: total,
        model: input.model,
      },
    });
    await tx.generationJob.createMany({
      data: fresh.map((j, position) => ({
        batchId: batch.id,
        makerId,
        projectId,
        cardId: j.cardId,
        mode,
        position,
        status: "queued",
        maxAttempts: MAX_ATTEMPTS,
        request: j.request as unknown as Prisma.InputJsonValue,
        estimateMicros: j.estimateMicros,
      })),
    });
    return { batchId: batch.id, queued: fresh.length, skipped: [...busy] };
  });
}

// Claim up to `limit` queued jobs of this process's mode, oldest batch first,
// in slot order; never one whose project is gone or whose batch was canceled.
// SKIP LOCKED: concurrent
// claimers (two processes) never take the same job. Each claim gets a fresh lease token and lease. A new job's
// availableAt is stamped by the app's clock, so the comparison tolerates a few
// seconds of skew against the database's; retry backoffs (30 s) are stamped by
// the database itself.
export async function claimJobs(
  mode: ProviderMode,
  limit: number,
  leaseSec: number,
): Promise<ClaimedJob[]> {
  assertDatabaseUrl();
  const claimed = await db.$queryRaw<{ id: string; leaseToken: string }[]>`
    WITH next AS (
      SELECT j."id" FROM "GenerationJob" j
      WHERE j."status" = 'queued' AND j."mode" = ${mode}
        AND j."projectId" IS NOT NULL
        AND j."availableAt" <= now() + interval '5 seconds'
        AND NOT ${STOPPED}
      ORDER BY j."createdAt", j."position"
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "GenerationJob" AS j
    SET "status" = 'running',
        "attempt" = j."attempt" + 1,
        "leaseToken" = gen_random_uuid()::text,
        "startedAt" = now(),
        "leaseUntil" = now() + make_interval(secs => ${leaseSec}::int)
    FROM next
    WHERE j."id" = next."id"
    RETURNING j."id", j."leaseToken"`;
  if (claimed.length === 0) return [];
  const tokens = new Map(claimed.map((c) => [c.id, c.leaseToken]));
  const jobs = await db.generationJob.findMany({
    where: { id: { in: [...tokens.keys()] } },
    orderBy: [{ createdAt: "asc" }, { position: "asc" }],
  });
  return jobs.map((j) => ({
    id: j.id,
    leaseToken: tokens.get(j.id) ?? "",
    attempt: j.attempt,
    maxAttempts: j.maxAttempts,
    makerId: j.makerId,
    projectId: j.projectId,
    cardId: j.cardId,
    request: j.request,
    estimateMicros: j.estimateMicros,
  }));
}

// Extend a running job's lease. false = the lease was lost (requeued
// elsewhere): the worker stops writing for it.
export async function renewLease(
  id: string,
  token: string,
  leaseSec: number,
): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE "GenerationJob"
    SET "leaseUntil" = now() + make_interval(secs => ${leaseSec}::int)
    WHERE "id" = ${id} AND "leaseToken" = ${token} AND "status" = 'running'`;
  return count === 1;
}

// Mark that the paid call is going out, right before it. Guarded by the lease,
// the project and the batch: false = the lease was lost, the project deleted
// or the batch canceled, and the caller must not make the call.
export async function markCallStarted(
  id: string,
  token: string,
): Promise<boolean> {
  const count = await db.$executeRaw`
    UPDATE "GenerationJob" AS j SET "callStartedAt" = now()
    WHERE j."id" = ${id} AND j."leaseToken" = ${token} AND j."status" = 'running'
      AND j."projectId" IS NOT NULL AND NOT ${STOPPED}`;
  return count === 1;
}

// Record what a call cost, as soon as it is known. Not guarded by the lease:
// money spent is recorded even by a worker that lost its lease. Adds to what
// the job already recorded, so no charge is ever overwritten.
export async function recordCost(
  id: string,
  usage: unknown,
  actualMicros: number | null,
): Promise<void> {
  const json = usage === undefined ? null : JSON.stringify(usage);
  await db.$executeRaw`
    UPDATE "GenerationJob"
    SET "usage" = COALESCE(${json}::jsonb, "usage"),
        "actualMicros" = CASE WHEN ${actualMicros}::int IS NULL THEN "actualMicros"
          ELSE COALESCE("actualMicros", 0) + ${actualMicros}::int END
    WHERE "id" = ${id}`;
}

// Finish a job and put its output on the card, in one transaction (job, then
// card; never the project row, so it cannot deadlock with an autosave). false
// = the lease was lost and nothing was written.
export async function completeJob(
  id: string,
  token: string,
  outputUrl: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const done = await tx.generationJob.updateMany({
      where: { id, leaseToken: token, status: "running" },
      data: {
        status: "done",
        outputUrl,
        error: null,
        finishedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (done.count !== 1) return false;
    const job = await tx.generationJob.findUniqueOrThrow({
      where: { id },
      select: { projectId: true, cardId: true },
    });
    if (job.projectId) {
      await tx.card.updateMany({
        where: { projectId: job.projectId, cardId: job.cardId },
        data: { outputs: [outputUrl], status: "done", vectorUrl: null },
      });
    }
    return true;
  });
}

// A failed attempt: back to the queue after the backoff, or failed for good.
// `mayBeCharged` keeps the call mark (the call was paid, or its outcome is
// unknown), so the job counts at its estimate until a cost is recorded; such a
// job is never retried. Otherwise the provider answered with an error, nothing
// was generated, and the mark is cleared. A job whose batch was canceled is
// not retried: it is canceled, unless its call may have been charged.
export async function failJob(
  id: string,
  token: string,
  error: string,
  outcome: { retry: boolean; mayBeCharged: boolean },
): Promise<boolean> {
  if (outcome.retry && outcome.mayBeCharged) {
    throw new Error("a job that may have been charged is never retried");
  }
  const { retry, mayBeCharged } = outcome;
  const count = await db.$executeRaw`
    UPDATE "GenerationJob" AS j
    SET "status" = CASE
          WHEN ${mayBeCharged}::boolean THEN 'failed'
          WHEN ${STOPPED} THEN 'canceled'
          WHEN ${retry}::boolean THEN 'queued'
          ELSE 'failed' END,
        "finishedAt" = CASE
          WHEN ${retry}::boolean AND NOT ${STOPPED} THEN NULL
          ELSE now() END,
        "error" = ${error},
        "callStartedAt" = CASE WHEN ${mayBeCharged}::boolean THEN j."callStartedAt" END,
        "availableAt" = now() + make_interval(secs => ${RETRY_BACKOFF_MS / 1000}::int),
        "leaseToken" = NULL,
        "leaseUntil" = NULL
    WHERE j."id" = ${id} AND j."leaseToken" = ${token} AND j."status" = 'running'`;
  return count === 1;
}

// Jobs whose worker died (lease expired). One that died before its paid call
// goes back to the queue under the retry rule, so a job that kills its process
// every time is failed after its last attempt; one whose batch was canceled is
// canceled instead (so is one whose project is gone). One that died during or
// after the call is never requeued —
// it may have been charged: it fails, and counts at its estimate unless the
// worker still records the real cost. The same sweep cancels queued jobs left
// behind by a cancel or a deleted project. Returns how many expired jobs it closed or requeued.
export async function requeueExpired(mode: ProviderMode): Promise<number> {
  const [, expired] = await db.$transaction([
    db.$executeRaw`
      UPDATE "GenerationJob" AS j
      SET "status" = 'canceled', "finishedAt" = now()
      WHERE j."status" = 'queued' AND j."mode" = ${mode} AND ${STOPPED}`,
    db.$executeRaw`
      UPDATE "GenerationJob" AS j
      SET "status" = CASE
            WHEN j."callStartedAt" IS NOT NULL THEN 'failed'
            WHEN ${STOPPED} THEN 'canceled'
            WHEN j."attempt" < j."maxAttempts" THEN 'queued'
            ELSE 'failed' END,
          "error" = CASE
            WHEN j."callStartedAt" IS NOT NULL
              THEN 'The worker stopped during the paid call; it may have been charged, so it was not retried.'
            ELSE COALESCE(j."error", 'the worker stopped (lease expired)') END,
          "availableAt" = now() + make_interval(secs => ${RETRY_BACKOFF_MS / 1000}::int),
          "finishedAt" = CASE
            WHEN j."callStartedAt" IS NULL AND NOT ${STOPPED}
              AND j."attempt" < j."maxAttempts" THEN NULL
            ELSE now() END,
          "leaseToken" = NULL,
          "leaseUntil" = NULL
      WHERE j."status" = 'running' AND j."mode" = ${mode} AND j."leaseUntil" < now()`,
  ]);
  return expired;
}

// Cancel what has not started. A running job finishes its call if the call
// already went out; otherwise it never starts it (markCallStarted) and is
// never retried (failJob, requeueExpired).
export async function cancelBatch(
  makerId: string,
  batchId: string,
): Promise<number> {
  assertDatabaseUrl();
  return db.$transaction(async (tx) => {
    const canceled = await tx.generationJob.updateMany({
      where: { batchId, makerId, status: "queued" },
      data: { status: "canceled", finishedAt: new Date() },
    });
    await tx.generationBatch.updateMany({
      where: { id: batchId, makerId },
      data: { canceledAt: new Date() },
    });
    return canceled.count;
  });
}

// A direct studio call (no batch) holds its reservation in a running row, so
// the cap covers every paid call. The lease outlasts the SDK's own timeout;
// if the process dies, the worker's sweep closes the row (requeueExpired).
const DIRECT_LEASE_MS = 15 * 60 * 1000;

// Reserve a direct call's estimated max: under the maker lock (like
// enqueueBatch) it must fit the cap with what is spent and reserved.
export async function reserveDirectCall(input: {
  makerId: string;
  provider: string;
  model: string;
  estimateMicros: number;
}): Promise<string> {
  assertDatabaseUrl();
  return db.$transaction(async (tx) => {
    const [maker] = await tx.$queryRaw<{ cap: number }[]>`
      SELECT "monthlyCapCents"::int AS "cap" FROM "Maker"
      WHERE "id" = ${input.makerId} FOR UPDATE`;
    if (!maker) throw new Error("maker not found");
    const used = await spend(tx, input.makerId);
    const capMicros = maker.cap * CENT_MICROS;
    if (
      !canAfford({ ...used, requestMicros: input.estimateMicros, capMicros })
    ) {
      throw new QueueRefusal(
        "cap",
        "This generation would go over this month's spending cap.",
      );
    }
    const now = new Date();
    const row = await tx.generationJob.create({
      data: {
        makerId: input.makerId,
        cardId: "direct",
        mode: "live",
        status: "running",
        attempt: 1,
        maxAttempts: 1,
        estimateMicros: input.estimateMicros,
        request: {
          kind: "direct",
          provider: input.provider,
          model: input.model,
        },
        startedAt: now,
        leaseUntil: new Date(now.getTime() + DIRECT_LEASE_MS),
      },
    });
    return row.id;
  });
}

// The direct call's request is going out.
export async function markDirectCall(id: string): Promise<void> {
  await db.$executeRaw`
    UPDATE "GenerationJob" SET "callStartedAt" = now()
    WHERE "id" = ${id} AND "status" = 'running'`;
}

// Close a direct call's row: its measured cost, or its failure (by the queue's
// rule: an answered error counts nothing, no answer counts at the estimate).
export async function closeDirectCall(
  id: string,
  outcome:
    | { usage: unknown; actualMicros: number | null }
    | { error: string; mayBeCharged: boolean },
): Promise<void> {
  if ("error" in outcome) {
    await db.generationJob.updateMany({
      where: { id, status: "running" },
      data: {
        status: "failed",
        error: outcome.error,
        finishedAt: new Date(),
        leaseUntil: null,
        ...(outcome.mayBeCharged ? {} : { callStartedAt: null }),
      },
    });
    return;
  }
  await recordCost(id, outcome.usage, outcome.actualMicros);
  await db.generationJob.updateMany({
    where: { id, status: "running" },
    data: { status: "done", finishedAt: new Date(), leaseUntil: null },
  });
}

export interface BatchProgress {
  batchId: string;
  queued: number;
  running: number;
  done: number;
  failed: number;
  canceled: number;
}

export interface GenerationState {
  version: string;
  jobs: Record<string, JobView>;
  cards: Record<
    string,
    { status: string; outputs: string[]; vectorUrl: string | null }
  >;
  batch: BatchProgress | null;
  budget: Budget;
}

// What the board and the slot editor poll: each card's latest job, the cards'
// generation state, the running batch's progress and the month's budget, plus
// a version that changes whenever any of it does.
export async function projectGenerationState(
  makerId: string,
  projectId: string,
): Promise<GenerationState> {
  assertDatabaseUrl();
  const latest = await db.$queryRaw<
    {
      cardId: string;
      status: JobStatus;
      attempt: number;
      error: string | null;
    }[]
  >`
    SELECT DISTINCT ON ("cardId") "cardId", "status", "attempt", "error"
    FROM "GenerationJob"
    WHERE "projectId" = ${projectId} AND "makerId" = ${makerId}
      AND "batchId" IS NOT NULL
    ORDER BY "cardId", "createdAt" DESC`;
  const cards = await db.card.findMany({
    where: { projectId, project: { makerId } },
    select: { cardId: true, status: true, outputs: true, vectorUrl: true },
  });
  const active = await db.generationJob.findFirst({
    where: { projectId, makerId, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: { batchId: true },
  });
  let batch: BatchProgress | null = null;
  if (active?.batchId) {
    const counts = await db.generationJob.groupBy({
      by: ["status"],
      where: { batchId: active.batchId },
      _count: { _all: true },
    });
    const n = (status: JobStatus) =>
      counts.find((c) => c.status === status)?._count._all ?? 0;
    batch = {
      batchId: active.batchId,
      queued: n("queued"),
      running: n("running"),
      done: n("done"),
      failed: n("failed"),
      canceled: n("canceled"),
    };
  }
  const state = {
    jobs: Object.fromEntries(
      latest.map((j) => [
        j.cardId,
        {
          status: j.status,
          attempt: j.attempt,
          ...(j.error ? { error: j.error } : {}),
        },
      ]),
    ),
    cards: Object.fromEntries(
      cards.map((c) => [
        c.cardId,
        {
          status: c.status,
          outputs: Array.isArray(c.outputs)
            ? c.outputs.filter((o): o is string => typeof o === "string")
            : [],
          vectorUrl: c.vectorUrl,
        },
      ]),
    ),
    batch,
    budget: await budget(makerId),
  };
  const version = createHash("sha1")
    .update(JSON.stringify([state.jobs, state.cards, state.batch]))
    .digest("hex")
    .slice(0, 16);
  return { version, ...state };
}

export interface OutputSource {
  prompt: string;
  provider: string;
  model: string;
  // "Veo 3.1 Fast", "Sora 2 (retired)".
  label: string;
  costMicros: number | null;
  generatedAt: string | null;
  // A video's length, aspect and resolution, as it was rendered.
  seconds?: number;
  aspect?: string;
  resolution?: string;
}

// What produced each of these outputs: the queue job that finished with it
// (its prompt, model and measured cost), for a delivery's manifest.
export async function outputSources(
  projectId: string,
  outputs: string[],
): Promise<Map<string, OutputSource>> {
  assertDatabaseUrl();
  if (outputs.length === 0) return new Map();
  const jobs = await db.generationJob.findMany({
    where: { projectId, status: "done", outputUrl: { in: outputs } },
    select: {
      outputUrl: true,
      request: true,
      actualMicros: true,
      finishedAt: true,
    },
  });
  const sources = new Map<string, OutputSource>();
  for (const job of jobs) {
    const request = GenerationRequest.safeParse(job.request);
    if (!job.outputUrl || !request.success) continue;
    sources.set(job.outputUrl, {
      prompt: request.data.prompt,
      provider: request.data.model.provider,
      model: request.data.model.model,
      label: modelLabel(request.data.model),
      costMicros: job.actualMicros,
      generatedAt: job.finishedAt?.toISOString() ?? null,
      ...(request.data.kind === "video"
        ? {
            seconds: request.data.durationSec,
            aspect: request.data.model.aspect,
            resolution: request.data.model.resolution ?? "720p",
          }
        : {}),
    });
  }
  return sources;
}
