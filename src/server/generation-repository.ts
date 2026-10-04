import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { canAfford } from "@/domain/generation-cost";
import type { GenerationRequest } from "@/domain/generation-request";
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
// which is always recorded. Money is in micro-dollars.

export type ProviderMode = "live" | "mock";

export class QueueRefusal extends Error {
  constructor(
    readonly reason: "cap" | "estimate-changed" | "already-queued",
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

type Tx = Prisma.TransactionClient;

// What this calendar month (UTC) has spent on live generations, and what live
// jobs in the queue have reserved (their recorded cost, else their estimate).
// One statement, so a job moving to done mid-read is counted exactly once.
async function spend(
  tx: Tx | typeof db,
  makerId: string,
): Promise<{ spentMicros: number; reservedMicros: number }> {
  const [row] = await tx.$queryRaw<{ spent: number; reserved: number }[]>`
    SELECT
      COALESCE(SUM(CASE
        WHEN "status" IN ('done', 'failed', 'canceled')
          AND "finishedAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        THEN COALESCE("actualMicros", CASE WHEN "status" = 'done' THEN "estimateMicros" ELSE 0 END)
        ELSE 0 END), 0)::float8 AS "spent",
      COALESCE(SUM(CASE
        WHEN "status" IN ('queued', 'running')
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
// queued or running is never queued twice. A live batch must fit the monthly
// cap; the server's estimate may not exceed what the maker was shown.
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
    const fresh = input.jobs.filter((j) => !busy.has(j.cardId));
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
// in slot order. SKIP LOCKED: concurrent claimers (two processes) never take
// the same job. Each claim gets a fresh lease token and lease. A new job's
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
      SELECT "id" FROM "GenerationJob"
      WHERE "status" = 'queued' AND "mode" = ${mode}
        AND "availableAt" <= now() + interval '5 seconds'
      ORDER BY "createdAt", "position"
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

// Record what a call cost, as soon as it is known. Not guarded by the lease:
// money spent is recorded even by a worker that lost its lease.
export async function recordCost(
  id: string,
  usage: unknown,
  actualMicros: number | null,
): Promise<void> {
  await db.generationJob.update({
    where: { id },
    data: {
      usage:
        usage === undefined ? Prisma.DbNull : (usage as Prisma.InputJsonValue),
      actualMicros,
    },
  });
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
export async function failJob(
  id: string,
  token: string,
  error: string,
  retry: boolean,
): Promise<boolean> {
  const count = retry
    ? await db.$executeRaw`
        UPDATE "GenerationJob"
        SET "status" = 'queued', "error" = ${error},
            "availableAt" = now() + make_interval(secs => ${RETRY_BACKOFF_MS / 1000}::int),
            "leaseToken" = NULL, "leaseUntil" = NULL
        WHERE "id" = ${id} AND "leaseToken" = ${token} AND "status" = 'running'`
    : (
        await db.generationJob.updateMany({
          where: { id, leaseToken: token, status: "running" },
          data: {
            status: "failed",
            error,
            finishedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
          },
        })
      ).count;
  return count === 1;
}

// Jobs whose worker died (lease expired) go back to the queue under the same
// retry rule as a failure, so a job that kills its process every time is
// failed after its last attempt instead of being paid for forever.
export async function requeueExpired(mode: ProviderMode): Promise<number> {
  return db.$executeRaw`
    UPDATE "GenerationJob"
    SET "status" = CASE WHEN "attempt" < "maxAttempts" THEN 'queued' ELSE 'failed' END,
        "error" = COALESCE("error", 'the worker stopped (lease expired)'),
        "availableAt" = now() + make_interval(secs => ${RETRY_BACKOFF_MS / 1000}::int),
        "finishedAt" = CASE WHEN "attempt" < "maxAttempts" THEN NULL ELSE now() END,
        "leaseToken" = NULL,
        "leaseUntil" = NULL
    WHERE "status" = 'running' AND "mode" = ${mode} AND "leaseUntil" < now()`;
}

// Cancel what has not started; running jobs finish.
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

// A direct studio call's spend (no batch), so the cap covers every paid call.
export async function recordDirectSpend(input: {
  makerId: string;
  mode: ProviderMode;
  model: string;
  usage: unknown;
  actualMicros: number | null;
  estimateMicros: number;
}): Promise<void> {
  assertDatabaseUrl();
  await db.generationJob.create({
    data: {
      makerId: input.makerId,
      cardId: "direct",
      mode: input.mode,
      status: "done",
      attempt: 1,
      maxAttempts: 1,
      estimateMicros: input.estimateMicros,
      actualMicros: input.actualMicros,
      usage:
        input.usage === undefined
          ? Prisma.DbNull
          : (input.usage as Prisma.InputJsonValue),
      request: { kind: "image", model: input.model },
      startedAt: new Date(),
      finishedAt: new Date(),
    },
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
