import { costFromUsage, toMicros } from "@/domain/generation-cost";
import { GenerationRequest } from "@/domain/generation-request";
import { errorMessage, retryDecision } from "@/domain/queue";
import type { EditBytesResult, ImageProvider } from "@/providers/interfaces";
import type { ClaimedJob, ProviderMode } from "@/server/generation-repository";

// The background generation worker: one per server process (a globalThis
// singleton, started from src/instrumentation.ts), woken when a batch is
// queued and swept periodically. It claims jobs of its process's provider mode,
// runs at most `concurrency` at once, keeps their leases alive, and closes each
// one exactly once:
// - the paid call runs with a bounded timeout and no SDK retries;
// - its cost is recorded as soon as the call returns, before anything else;
// - storing the image is retried in-process — never the paid call;
// - a failure before the call is retried once if it may pass (domain
//   retryDecision); a failure after it is final (a retry would pay again).

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
    retry: boolean,
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
  result: EditBytesResult,
): Promise<string> {
  let last: unknown;
  for (let i = 0; i < STORE_ATTEMPTS; i++) {
    try {
      return await deps.storeAsset(result.bytes, result.mime, "cards");
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

export async function runJob(deps: WorkerDeps, job: ClaimedJob): Promise<void> {
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
        false,
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
      { timeoutMs: deps.callTimeoutMs },
    );
    paid = true;
    const usd = result.usage ? costFromUsage(result.model, result.usage) : null;
    await deps.recordCost(
      job.id,
      result.usage,
      usd === null ? null : toMicros(usd),
    );
    const url = await storeWithRetries(deps, result);
    await deps.completeJob(job.id, job.leaseToken, url);
  } catch (error) {
    const retry =
      !paid && retryDecision(job.attempt, error, job.maxAttempts).retry;
    deps.log(`generation job ${job.id} failed (retry: ${retry})`, error);
    await deps
      .failJob(job.id, job.leaseToken, errorMessage(error), retry)
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
