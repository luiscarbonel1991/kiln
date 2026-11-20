import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { canAfford } from "@/domain/generation-cost";
import { GenerationRequest } from "@/domain/generation-request";
import {
  modelEntry,
  modelLabel,
  type ProviderId,
} from "@/domain/model-defaults";
import {
  type JobRoute,
  type RouteEntry,
  ranOn,
  readJobRoute,
  routedRequest,
  sameModel,
} from "@/domain/model-routing";
import { generableCardIds, ProjectPlan } from "@/domain/plan";
import type { CardSpend } from "@/domain/project-cost";
import { readTakeCheck, type TakeCheck } from "@/domain/qc";
import {
  ACTIVE_JOB_STATUSES,
  type JobStatus,
  type JobView,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  readableFailure,
} from "@/domain/queue";
import { assertDatabaseUrl, db } from "@/lib/db";
import { noteBatchEnd } from "@/server/batch-end";
import type { MakerRef } from "@/server/maker-repository";

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
  // The models it may move to, in order (empty: it runs its one model).
  next?: RouteEntry[];
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
  route: unknown;
  estimateMicros: number;
  // Who queued it; the worker still runs it as its maker.
  memberId: string | null;
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

// What one job spent this calendar month (UTC), the cap's own rule: a
// finished job counts its measured cost; without one, its estimate if its
// paid call went out (the outcome is unknown), else nothing. Queued and
// running work is not spent. Every read of the month's spend sums this, so
// none can drift from the cap.
const SPENT_THIS_MONTH = Prisma.sql`CASE
  WHEN "status" IN ('done', 'failed', 'canceled')
    AND "finishedAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  THEN COALESCE("actualMicros", CASE WHEN "callStartedAt" IS NOT NULL THEN "estimateMicros" ELSE 0 END)
  ELSE 0 END`;

// What this calendar month (UTC) has spent on live generations, and what live
// jobs in the queue have reserved (their recorded cost, else their estimate);
// a queued job whose project is gone reserves nothing (it is never claimed).
// One statement, so a job moving to done mid-read is counted exactly once.
async function spend(
  tx: Tx | typeof db,
  makerId: string,
): Promise<{ spentMicros: number; reservedMicros: number }> {
  const [row] = await tx.$queryRaw<{ spent: number; reserved: number }[]>`
    SELECT
      COALESCE(SUM(${SPENT_THIS_MONTH}), 0)::float8 AS "spent",
      COALESCE(SUM(CASE
        WHEN "status" = 'running'
          OR ("status" = 'queued' AND "projectId" IS NOT NULL)
        THEN COALESCE("actualMicros", "estimateMicros")
        ELSE 0 END), 0)::float8 AS "reserved"
    FROM "GenerationJob"
    WHERE "makerId" = ${makerId} AND "mode" = 'live'`;
  return { spentMicros: row.spent, reservedMicros: row.reserved };
}

export interface MemberSpend {
  // Who started the work; null for a token, a script, work Kiln did on its
  // own, or work from before Kiln recorded it.
  memberId: string | null;
  spentMicros: number;
}

// This calendar month's live spend per person, highest first, by the cap's
// own rule (its rows add up to budget's spentMicros); a person with nothing
// spent has no row. With `only`, the one person's sum alone: a member never
// reads the others'.
export async function spendByMember(
  maker: MakerRef,
  only?: { memberId: string },
): Promise<MemberSpend[]> {
  assertDatabaseUrl();
  const rows = await db.$queryRaw<{ memberId: string | null; spent: number }[]>`
    SELECT "memberId", COALESCE(SUM(${SPENT_THIS_MONTH}), 0)::float8 AS "spent"
    FROM "GenerationJob"
    WHERE "makerId" = ${maker.id} AND "mode" = 'live'
      ${only ? Prisma.sql`AND "memberId" = ${only.memberId}` : Prisma.empty}
    GROUP BY "memberId"
    HAVING COALESCE(SUM(${SPENT_THIS_MONTH}), 0) > 0
    ORDER BY "spent" DESC, "memberId" NULLS LAST`;
  return rows.map((r) => ({ memberId: r.memberId, spentMicros: r.spent }));
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
  // The chat conversation whose paid tool queued it.
  sessionId?: string;
  // The person who queued it; none for a token, a script or the worker.
  memberId?: string | null;
}): Promise<{ batchId: string; queued: number; skipped: string[] }> {
  assertDatabaseUrl();
  const { makerId, projectId, mode } = input;
  return db.$transaction(async (tx) => {
    const [maker] = await tx.$queryRaw<{ cap: number }[]>`
      SELECT "monthlyCapCents"::int AS "cap" FROM "Maker"
      WHERE "id" = ${makerId} FOR UPDATE`;
    if (!maker) throw new Error("maker not found");
    // The project row too (setSlotOff and approvals take it): a planned
    // project generates only its scene slots that are switched on, a design
    // only its drawings (the studio's image cards).
    const [project] = await tx.$queryRaw<{ plan: unknown; type: string }[]>`
      SELECT "plan", "type" FROM "Project"
      WHERE "id" = ${projectId} AND "makerId" = ${makerId} FOR UPDATE`;
    if (!project) throw new Error("project not found");
    if (project.plan === null && project.type === "design") {
      const drawings = await tx.card.findMany({
        where: { projectId, type: "image" },
        select: { cardId: true },
      });
      const allowed = new Set(drawings.map((c) => c.cardId));
      if (input.jobs.some((j) => !allowed.has(j.cardId))) {
        throw new QueueRefusal(
          "not-in-plan",
          "Only the design's drawings can be drawn.",
        );
      }
    } else {
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
    // Each job remembers the product version its request was built from.
    const link = await tx.projectProduct.findFirst({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { productHash: true },
    });
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
        ...(j.next?.length
          ? {
              route: {
                next: j.next,
                switched: [],
              } satisfies JobRoute as unknown as Prisma.InputJsonValue,
            }
          : {}),
        estimateMicros: j.estimateMicros,
        productHash: link?.productHash ?? null,
        sessionId: input.sessionId ?? null,
        memberId: input.memberId ?? null,
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
    route: j.route,
    estimateMicros: j.estimateMicros,
    memberId: j.memberId,
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
// card; never the project row, so it cannot deadlock with an autosave), with
// what Kiln read in it, so a take never shows before its check. false = the
// lease was lost and nothing was written.
export async function completeJob(
  id: string,
  token: string,
  outputUrl: string,
  check?: TakeCheck | null,
): Promise<boolean> {
  const batchId = await db.$transaction(async (tx) => {
    const done = await tx.generationJob.updateMany({
      where: { id, leaseToken: token, status: "running" },
      data: {
        status: "done",
        outputUrl,
        error: null,
        finishedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
        ...(check ? { takeCheck: check } : {}),
      },
    });
    if (done.count !== 1) return false;
    const job = await tx.generationJob.findUniqueOrThrow({
      where: { id },
      select: { projectId: true, cardId: true, batchId: true },
    });
    if (job.projectId) {
      await tx.card.updateMany({
        where: { projectId: job.projectId, cardId: job.cardId },
        data: { outputs: [outputUrl], status: "done", vectorUrl: null },
      });
    }
    return job.batchId;
  });
  if (batchId === false) return false;
  await noteBatchEnd(batchId);
  return true;
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
  if (count === 1) {
    const job = await db.generationJob.findUnique({
      where: { id },
      select: { batchId: true, status: true },
    });
    if (job && job.status !== "queued") await noteBatchEnd(job.batchId);
  }
  return count === 1;
}

// A job moves to the next model of its route after a failure another model
// may fix (domain fallbackAfter; nothing was charged): its request is the
// same on the new model, its route records the move, and it goes back to the
// queue at once, its attempts counted afresh for the new model. Its batch's
// jobs still queued on the same model move with it, so a batch stays on one
// model (another model changes the look); each records why. false = the lease
// was lost or the batch canceled: the caller fails the job as usual.
export async function fallBackJob(
  job: { id: string; leaseToken: string },
  move: { to: RouteEntry; rest: RouteEntry[]; reason: string },
  runnable: (entry: RouteEntry, request: GenerationRequest) => boolean,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<
      {
        batchId: string | null;
        request: unknown;
        route: unknown;
      }[]
    >`
      SELECT j."batchId", j."request", j."route"
      FROM "GenerationJob" j
      WHERE j."id" = ${job.id} AND j."leaseToken" = ${job.leaseToken}
        AND j."status" = 'running' AND NOT ${STOPPED}
      FOR UPDATE`;
    if (!row) return false;
    const request = GenerationRequest.parse(row.request);
    const at = new Date().toISOString();
    const from = modelOf(request);
    const moved = (
      current: GenerationRequest,
      route: JobRoute,
      rest: RouteEntry[],
      reason: string,
    ) => ({
      request: routedRequest(
        current,
        move.to,
      ) as unknown as Prisma.InputJsonValue,
      route: {
        next: rest,
        switched: [
          ...route.switched,
          { from: modelOf(current), to: move.to, reason, at },
        ],
      } satisfies JobRoute as unknown as Prisma.InputJsonValue,
    });
    await tx.generationJob.update({
      where: { id: job.id },
      data: {
        ...moved(request, readJobRoute(row.route), move.rest, move.reason),
        status: "queued",
        // A new model is a new start: its own retry allowance, and the board
        // shows it generating, not retrying.
        attempt: 0,
        maxAttempts: MAX_ATTEMPTS,
        error: null,
        callStartedAt: null,
        availableAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (!row.batchId) return true;
    const queued = await tx.$queryRaw<
      { id: string; request: unknown; route: unknown }[]
    >`
      SELECT "id", "request", "route" FROM "GenerationJob"
      WHERE "batchId" = ${row.batchId} AND "status" = 'queued'
        AND "id" <> ${job.id}
      FOR UPDATE`;
    for (const other of queued) {
      const parsed = GenerationRequest.safeParse(other.request);
      if (!parsed.success || !sameModel(parsed.data.model, from)) continue;
      const route = readJobRoute(other.route);
      const index = route.next.findIndex((m) => sameModel(m, move.to));
      if (index < 0 || !runnable(move.to, parsed.data)) continue;
      await tx.generationJob.update({
        where: { id: other.id },
        data: moved(
          parsed.data,
          route,
          route.next.slice(index + 1),
          `${move.reason} (on another frame of the batch)`,
        ),
      });
    }
    return true;
  });
}

const modelOf = (request: GenerationRequest): RouteEntry => ({
  provider: request.model.provider,
  model: request.model.model,
  ...(request.model.quality ? { quality: request.model.quality } : {}),
  ...(request.model.resolution ? { resolution: request.model.resolution } : {}),
});

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
  const { canceled, own } = await db.$transaction(async (tx) => {
    const jobs = await tx.generationJob.updateMany({
      where: { batchId, makerId, status: "queued" },
      data: { status: "canceled", finishedAt: new Date() },
    });
    const batch = await tx.generationBatch.updateMany({
      where: { id: batchId, makerId },
      data: { canceledAt: new Date() },
    });
    return { canceled: jobs.count, own: batch.count === 1 };
  });
  // Only the maker's own batch is ended: the id comes from the client.
  if (own) await noteBatchEnd(batchId);
  return canceled;
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
  // The project the call works for (the listing text), so it counts there.
  projectId?: string;
  // The move along its route that led to this call (domain JobRoute).
  route?: JobRoute;
  // The chat conversation whose paid tool made it.
  sessionId?: string;
  // The person who made it; none for a token or a script.
  memberId?: string | null;
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
        projectId: input.projectId ?? null,
        sessionId: input.sessionId ?? null,
        memberId: input.memberId ?? null,
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
        ...(input.route
          ? { route: input.route as unknown as Prisma.InputJsonValue }
          : {}),
        startedAt: now,
        leaseUntil: new Date(now.getTime() + DIRECT_LEASE_MS),
      },
    });
    return row.id;
  });
}

// A key checked from Settings (free: the provider lists its models), kept as
// a finished call of no cost so provider health reads it like any other.
export async function recordKeyCheck(input: {
  makerId: string;
  provider: string;
  error: string | null;
  // The offered models the provider no longer lists (domain unlistedModels).
  unlisted?: string[];
  // The person who ran the check.
  memberId?: string | null;
}): Promise<void> {
  assertDatabaseUrl();
  const now = new Date();
  await db.generationJob.create({
    data: {
      makerId: input.makerId,
      memberId: input.memberId ?? null,
      cardId: "key-check",
      mode: "live",
      status: input.error === null ? "done" : "failed",
      attempt: 1,
      maxAttempts: 1,
      estimateMicros: 0,
      actualMicros: 0,
      request: {
        kind: "key-check",
        provider: input.provider,
        model: "models list",
        ...(input.unlisted ? { unlisted: input.unlisted } : {}),
      },
      error: input.error,
      startedAt: now,
      finishedAt: now,
    },
  });
}

export type UnlistedModels = Partial<
  Record<ProviderId, { models: string[]; at: string }>
>;

// What each provider's latest key check that listed its models found missing:
// the offered models it no longer names, with the day it was checked. A model
// Kiln has retired since is left out (it is refused anyway).
export async function readUnlisted(makerId: string): Promise<UnlistedModels> {
  const rows = await db.$queryRaw<
    { provider: string; unlisted: unknown; at: Date }[]
  >`
    SELECT DISTINCT ON ("request" ->> 'provider')
           "request" ->> 'provider' AS "provider",
           "request" -> 'unlisted' AS "unlisted",
           "finishedAt" AS "at"
    FROM "GenerationJob"
    WHERE "makerId" = ${makerId}
      AND "mode" = 'live'
      AND "status" = 'done'
      AND "request" ->> 'kind' = 'key-check'
      AND "request" ? 'unlisted'
    ORDER BY "request" ->> 'provider', "finishedAt" DESC`;
  const found: UnlistedModels = {};
  for (const row of rows) {
    if (row.provider !== "openai" && row.provider !== "google") continue;
    const provider = row.provider;
    const models = (Array.isArray(row.unlisted) ? row.unlisted : []).filter(
      (id): id is string =>
        typeof id === "string" && !modelEntry({ provider, model: id })?.retired,
    );
    if (models.length > 0) {
      found[provider] = { models, at: row.at.toISOString() };
    }
  }
  return found;
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
}

// What the board and the slot editor poll: each card's latest job, the cards'
// generation state and the running batch's progress, plus a version that
// changes whenever any of it does. No amount of this month's: a member polls
// it too (the owner's amounts are monthLimit's).
const withRanOn = (route: unknown) => {
  const ran = ranOn(readJobRoute(route));
  return ran ? { ranOn: ran } : {};
};

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
      route: unknown;
      test: boolean | null;
    }[]
  >`
    SELECT DISTINCT ON ("cardId") "cardId", "status", "attempt", "error", "route",
           ("request" ->> 'test') = 'true' AS "test"
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
          ...(j.error ? { error: readableFailure(j.error) } : {}),
          ...withRanOn(j.route),
          // Its take is a test take (low quality, never approved).
          ...(j.test && j.status === "done" ? { test: true } : {}),
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
  // "Gemini Omni Flash", "Veo 3.1 Fast (retired)".
  label: string;
  costMicros: number | null;
  generatedAt: string | null;
  // A video's length, aspect and resolution, as it was rendered.
  seconds?: number;
  aspect?: string;
  resolution?: string;
  // It moved down its route: the first model it left and why.
  fallback?: { from: string; reason: string };
  // What Kiln read in it before it landed (an image take).
  check?: SourceCheck;
}

export interface SourceCheck {
  status: TakeCheck["status"];
  problems: string[];
  scale?: string;
  unchecked?: string;
}

export interface OutputFacts {
  // The product version it was made from: null for a job from before
  // versions were kept.
  productHash: string | null;
  // What Kiln read in it: null for a take from before the check (or a video).
  check: TakeCheck | null;
}

// What is known of each of these outputs from the job that finished with it;
// an output no job made (a studio edit) is absent.
export async function outputFacts(
  maker: MakerRef,
  projectId: string,
  outputs: string[],
): Promise<Map<string, OutputFacts>> {
  assertDatabaseUrl();
  if (outputs.length === 0) return new Map();
  const jobs = await db.generationJob.findMany({
    where: {
      projectId,
      makerId: maker.id,
      status: "done",
      outputUrl: { in: outputs },
    },
    select: { outputUrl: true, productHash: true, takeCheck: true },
  });
  return new Map(
    jobs.flatMap((job) =>
      job.outputUrl
        ? [
            [
              job.outputUrl,
              {
                productHash: job.productHash,
                check: readTakeCheck(job.takeCheck),
              },
            ] as const,
          ]
        : [],
    ),
  );
}

// What a project spent, card by card, under the budget's rule (live jobs, a
// job's measured cost, else its estimate once its paid call went out), with
// each card's takes (its finished generations). Its direct calls (the
// listing text) belong to no card.
export async function projectSpend(
  maker: MakerRef,
  projectId: string,
): Promise<{
  byCard: Map<string, CardSpend>;
  directMicros: number;
}> {
  assertDatabaseUrl();
  const rows = await db.$queryRaw<
    { cardId: string; spent: number; takes: number }[]
  >`
    SELECT "cardId",
      COALESCE(SUM(COALESCE("actualMicros",
        CASE WHEN "callStartedAt" IS NOT NULL THEN "estimateMicros" ELSE 0 END)), 0)::float8 AS "spent",
      (COUNT(*) FILTER (WHERE "status" = 'done' AND "outputUrl" IS NOT NULL))::int AS "takes"
    FROM "GenerationJob"
    WHERE "projectId" = ${projectId} AND "makerId" = ${maker.id}
      AND "mode" = 'live'
      AND "status" IN ('done', 'failed', 'canceled')
    GROUP BY "cardId"`;
  const byCard = new Map<string, CardSpend>();
  let directMicros = 0;
  for (const row of rows) {
    if (row.cardId === "direct") directMicros += row.spent;
    else byCard.set(row.cardId, { spentMicros: row.spent, takes: row.takes });
  }
  return { byCard, directMicros };
}

export interface SessionSpend {
  spentMicros: number;
  queuedMicros: number;
}

// What the paid tools of one chat conversation spent, under the budget's
// rule (live jobs, a job's measured cost, else its estimate once its paid
// call went out), and what its queued and running work has reserved.
export async function sessionSpend(
  makerId: string,
  sessionId: string,
): Promise<SessionSpend> {
  assertDatabaseUrl();
  const [row] = await db.$queryRaw<{ spent: number; queued: number }[]>`
    SELECT
      COALESCE(SUM(CASE
        WHEN "status" IN ('done', 'failed', 'canceled')
        THEN COALESCE("actualMicros", CASE WHEN "callStartedAt" IS NOT NULL THEN "estimateMicros" ELSE 0 END)
        ELSE 0 END), 0)::float8 AS "spent",
      COALESCE(SUM(CASE
        WHEN "status" = 'running'
          OR ("status" = 'queued' AND "projectId" IS NOT NULL)
        THEN COALESCE("actualMicros", "estimateMicros")
        ELSE 0 END), 0)::float8 AS "queued"
    FROM "GenerationJob"
    WHERE "makerId" = ${makerId} AND "sessionId" = ${sessionId}
      AND "mode" = 'live'`;
  return { spentMicros: row.spent, queuedMicros: row.queued };
}

// What produced each of these outputs: the queue job that finished with it
// (its prompt, model and measured cost), for a delivery's manifest.
export async function outputSources(
  maker: MakerRef,
  projectId: string,
  outputs: string[],
): Promise<Map<string, OutputSource>> {
  assertDatabaseUrl();
  if (outputs.length === 0) return new Map();
  const jobs = await db.generationJob.findMany({
    where: {
      projectId,
      makerId: maker.id,
      status: "done",
      outputUrl: { in: outputs },
    },
    select: {
      outputUrl: true,
      request: true,
      route: true,
      actualMicros: true,
      finishedAt: true,
      takeCheck: true,
    },
  });
  const sources = new Map<string, OutputSource>();
  for (const job of jobs) {
    const request = GenerationRequest.safeParse(job.request);
    if (!job.outputUrl || !request.success) continue;
    const moved = ranOn(readJobRoute(job.route));
    const check = readTakeCheck(job.takeCheck);
    sources.set(job.outputUrl, {
      ...(moved
        ? { fallback: { from: moved.from, reason: moved.reason } }
        : {}),
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
      ...(check
        ? {
            check: {
              status: check.status,
              problems: check.problems,
              ...(check.scale ? { scale: check.scale } : {}),
              ...(check.unchecked ? { unchecked: check.unchecked } : {}),
              ...(check.look
                ? {
                    look: {
                      status: check.look.status,
                      problems: check.look.problems,
                      ...(check.look.model ? { model: check.look.model } : {}),
                      ...(check.look.why ? { why: check.look.why } : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
    });
  }
  return sources;
}
