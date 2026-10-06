import { costFromUsage, toMicros } from "@/domain/generation-cost";
import { GenerationRequest } from "@/domain/generation-request";
import { errorMessage, hadResponse, retryDecision } from "@/domain/queue";
import type { EditBytesResult, ImageProvider } from "@/providers/interfaces";
import type { ClaimedJob, ProviderMode } from "@/server/generation-repository";

// The background generation worker: one per server process (a globalThis
// singleton, started from src/instrumentation.ts), woken when a batch is
// queued and swept periodically. It claims jobs of its process's provider mode,
// runs at most `concurrency` at once, keeps their leases alive, and closes each
// one exactly once. A job pays for at most one call:
// - the call is marked under the lease right before it goes out; no mark, no
//   call;
// - the paid call runs with a bounded timeout and no SDK retries;
// - its cost is recorded as soon as the call returns, before anything else
//   (a failure to record it never loses the image);
// - storing the image is retried in-process — never the paid call;
// - a failure the provider answered (an HTTP error: nothing generated) is
//   retried once if it may pass (domain retryDecision); a call with no answer
//   (timeout, dropped connection) or one that was paid is final.

export interface WorkerDeps {
  mode: ProviderMode;
  concurrency: number;
  leaseSec: number;
  renewMs: number;
  sweepMs: number;
  callTimeoutMs: number;
  claimJobs(
    mode: ProviderMode,
    limit: number,
    leaseSec: number,
  ): Promise<ClaimedJob[]>;
  renewLease(id: string, token: string, leaseSec: number): Promise<boolean>;
  markCallStarted(id: string, token: string): Promise<boolean>;
  recordCost(
    id: string,
    usage: unknown,
    actualMicros: number | null,
  ): Promise<void>;
  completeJob(id: string, token: string, outputUrl: string): Promise<boolean>;
  failJob(
    id: string,
    token: string,
    error: string,
    outcome: { retry: boolean; mayBeCharged: boolean },
  ): Promise<boolean>;
  requeueExpired(mode: ProviderMode): Promise<number>;
  overCap(makerId: string): Promise<boolean>;
  provider(id: "google" | "openai"): ImageProvider;
  storeAsset(bytes: Uint8Array, mime: string, prefix: string): Promise<string>;
  log(message: string, error?: unknown): void;
}

export interface Worker {
  wake(): void;
  stop(): void;
  active(): number;
  // Resolves when nothing is running and nothing claimable is left (tests).
  idle(): Promise<void>;
}

const STORE_ATTEMPTS = 3;

async function storeWithRetries(
  deps: WorkerDeps,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  let last: unknown;
  for (let i = 0; i < STORE_ATTEMPTS; i++) {
    try {
      return await deps.storeAsset(bytes, mime, "cards");
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

// The job lost its lease, its project was deleted or its batch canceled
// before the paid call: nothing was spent, and there is nothing to retry.
class CallNotStarted extends Error {
  constructor() {
    super(
      "The job was canceled, or lost its lease or its project, before the paid call; nothing was spent.",
    );
    this.name = "CallNotStarted";
  }
}

async function recordPaidCost(
  deps: WorkerDeps,
  job: ClaimedJob,
  result: EditBytesResult,
): Promise<void> {
  const usd = result.usage ? costFromUsage(result.model, result.usage) : null;
  try {
    await deps.recordCost(
      job.id,
      result.usage,
      usd === null ? null : toMicros(usd),
    );
  } catch (error) {
    // The job keeps its call mark, so it still counts at its estimate.
    deps.log(`could not record the cost of ${job.id}`, error);
  }
}

export async function runJob(deps: WorkerDeps, job: ClaimedJob): Promise<void> {
  let callStarted = false;
  let paid = false;
  const renew = setInterval(() => {
    void deps.renewLease(job.id, job.leaseToken, deps.leaseSec).catch(() => {});
  }, deps.renewMs);
  try {
    if (deps.mode === "live" && (await deps.overCap(job.makerId))) {
      await deps.failJob(
        job.id,
        job.leaseToken,
        "This month's spending cap was reached.",
        { retry: false, mayBeCharged: false },
      );
      return;
    }
    const request = GenerationRequest.parse(job.request);
    const provider = deps.provider(request.model.provider);
    if (!provider.editBytes) {
      throw Object.assign(new Error(`${provider.id} cannot run queued edits`), {
        name: "CapabilityError",
      });
    }
    const result = await provider.editBytes(
      {
        masterAssetUrl: request.masterAssetUrl,
        prompt: request.prompt,
        imageInputs: request.imageInputs,
        negative: request.negative,
        model: request.model,
      },
      {
        timeoutMs: deps.callTimeoutMs,
        beforeCall: async () => {
          if (!(await deps.markCallStarted(job.id, job.leaseToken))) {
            throw new CallNotStarted();
          }
          callStarted = true;
        },
      },
    );
    paid = true;
    await recordPaidCost(deps, job, result);
    if (!result.bytes) throw new Error("The provider returned no image.");
    const url = await storeWithRetries(deps, result.bytes, result.mime);
    await deps.completeJob(job.id, job.leaseToken, url);
  } catch (error) {
    const unanswered = callStarted && !paid && !hadResponse(error);
    const mayBeCharged = paid || unanswered;
    const retry =
      !mayBeCharged &&
      !(error instanceof CallNotStarted) &&
      retryDecision(job.attempt, error, job.maxAttempts).retry;
    const message = unanswered
      ? `The call got no answer (${errorMessage(error)}); it may have been charged, so it was not retried.`
      : errorMessage(error);
    deps.log(`generation job ${job.id} failed (retry: ${retry})`, error);
    await deps
      .failJob(job.id, job.leaseToken, message, { retry, mayBeCharged })
      .catch((e) => deps.log(`could not record the failure of ${job.id}`, e));
  } finally {
    clearInterval(renew);
  }
}

export function createWorker(deps: WorkerDeps): Worker {
  let running = 0;
  let pumping = false;
  let again = false;
  let stopped = false;
  const idleWaiters: (() => void)[] = [];

  const settleIdle = () => {
    if (running === 0 && !pumping) {
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  };

  // Claim and start jobs until the concurrency is full or the queue is empty.
  // A wake during a pump is not lost: the pump loops once more.
  async function pump(): Promise<void> {
    if (pumping) {
      again = true;
      return;
    }
    pumping = true;
    try {
      do {
        again = false;
        while (!stopped && running < deps.concurrency) {
          const jobs = await deps.claimJobs(
            deps.mode,
            deps.concurrency - running,
            deps.leaseSec,
          );
          if (jobs.length === 0) break;
          for (const job of jobs) {
            running++;
            void runJob(deps, job).finally(() => {
              running--;
              void pump();
              settleIdle();
            });
          }
        }
      } while (again && !stopped);
    } catch (error) {
      deps.log("the generation worker could not claim jobs", error);
    } finally {
      pumping = false;
      settleIdle();
    }
  }

  const sweep = setInterval(() => {
    void deps
      .requeueExpired(deps.mode)
      .then(() => pump())
      .catch((error) => deps.log("the generation sweep failed", error));
  }, deps.sweepMs);
  sweep.unref?.();

  return {
    wake: () => {
      void pump();
    },
    stop: () => {
      stopped = true;
      clearInterval(sweep);
    },
    active: () => running,
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        settleIdle();
      }),
  };
}
