import { costFromUsage, toMicros, videoCost } from "@/domain/generation-cost";
import {
  GenerationRequest,
  type ImageGenerationRequest,
  type VideoGenerationRequest,
} from "@/domain/generation-request";
import {
  fallbackAfter,
  pickNext,
  type RouteEntry,
  readJobRoute,
} from "@/domain/model-routing";
import {
  describeProviderError,
  errorMessage,
  hadResponse,
  retryDecision,
} from "@/domain/queue";
import type { ImageProvider, VideoProvider } from "@/providers/interfaces";
import type { ClaimedJob, ProviderMode } from "@/server/generation-repository";

// The background generation worker: one per server process (a globalThis
// singleton, started from src/instrumentation.ts), woken when a batch is
// queued and swept periodically. It claims jobs of its process's provider mode,
// runs at most `concurrency` at once, keeps their leases alive, and closes each
// one exactly once. A job pays for at most one call:
// - the call is marked under the lease right before it goes out; no mark, no
//   call;
// - the paid call runs with a bounded timeout and no SDK retries (a video's
//   create too; its render is polled to a deadline under a renewed lease);
// - its cost is recorded as soon as the call returns, before anything else
//   (a failure to record it never loses the image);
// - storing the image is retried in-process — never the paid call;
// - a failure the provider answered (an HTTP error: nothing generated) moves
//   to the next model of the job's route when another model may pass (domain
//   fallbackAfter; the route was fixed when the maker approved the estimate),
//   else is retried once if it may pass (domain retryDecision); a call with no
//   answer (timeout, dropped connection) or one that was paid is final.

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
  // Move a job to the next model of its route; false when it could not.
  fallBack(
    job: ClaimedJob,
    move: { to: RouteEntry; rest: RouteEntry[]; reason: string },
    runnable: (entry: RouteEntry, request: GenerationRequest) => boolean,
  ): Promise<boolean>;
  // Whether a model of the route may run this request now (key, price,
  // capability).
  runnable(entry: RouteEntry, request: GenerationRequest): boolean;
  overCap(makerId: string): Promise<boolean>;
  provider(id: "google" | "openai"): ImageProvider;
  videoProvider(id: "google" | "openai"): VideoProvider | undefined;
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
// Failures that are Kiln's, not a provider's (provider health skips them).
export const CAP_REACHED = "This month's spending cap was reached.";
export const NOT_STARTED =
  "The job was canceled, or lost its lease or its project, before the paid call; nothing was spent.";

class CallNotStarted extends Error {
  constructor() {
    super(NOT_STARTED);
    this.name = "CallNotStarted";
  }
}

async function recordPaidCost(
  deps: WorkerDeps,
  job: ClaimedJob,
  usage: unknown,
  usd: number | null,
): Promise<void> {
  try {
    await deps.recordCost(job.id, usage, usd === null ? null : toMicros(usd));
  } catch (error) {
    // The job keeps its call mark, so it still counts at its estimate.
    deps.log(`could not record the cost of ${job.id}`, error);
  }
}

// One paid call, marked right before it goes out; its output's bytes.
type Paid = { bytes: Uint8Array | null; mime: string; refusal?: string };

async function callImage(
  deps: WorkerDeps,
  job: ClaimedJob,
  request: ImageGenerationRequest,
  beforeCall: () => Promise<void>,
  onPaid: () => void,
): Promise<Paid> {
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
    { timeoutMs: deps.callTimeoutMs, beforeCall },
  );
  onPaid();
  await recordPaidCost(
    deps,
    job,
    result.usage,
    result.usage
      ? costFromUsage(
          { provider: request.model.provider, model: result.model },
          result.usage,
        )
      : null,
  );
  return {
    bytes: result.bytes,
    mime: result.mime,
    refusal: result.refusal,
  };
}

// A video: the approved start frame animated; costed from the usage the
// provider reports, else by the seconds rendered.
async function callVideo(
  deps: WorkerDeps,
  job: ClaimedJob,
  request: VideoGenerationRequest,
  beforeCall: () => Promise<void>,
  onPaid: () => void,
): Promise<Paid> {
  const provider = deps.videoProvider(request.model.provider);
  if (!provider?.animateBytes) {
    throw Object.assign(
      new Error(`${request.model.provider} cannot run queued videos`),
      { name: "CapabilityError" },
    );
  }
  const clip = await provider.animateBytes(
    {
      startFrameAssetId: request.startFrameUrl,
      prompt: request.prompt,
      motion: request.motion,
      durationSec: request.durationSec,
      negative: request.negative,
      model: request.model,
    },
    { beforeCall },
  );
  onPaid();
  const ran = {
    provider: request.model.provider,
    model: clip.model,
    resolution: request.model.resolution,
  };
  await recordPaidCost(
    deps,
    job,
    {
      seconds: clip.seconds,
      resolution: request.model.resolution,
      ...(clip.usage ? { tokens: clip.usage } : {}),
    },
    (clip.usage ? costFromUsage(ran, clip.usage) : null) ??
      videoCost(ran, clip.seconds),
  );
  return clip;
}

// Move the job down its route when the failure allows and a model may run it;
// true when it moved (it is queued again on that model).
async function moveDown(
  deps: WorkerDeps,
  job: ClaimedJob,
  provider: "google" | "openai",
  request: GenerationRequest,
  error: unknown,
  callStarted: boolean,
): Promise<boolean> {
  const route = readJobRoute(job.route);
  if (route.next.length === 0) return false;
  const failure = fallbackAfter(provider, error, { callStarted });
  const runnable = (entry: RouteEntry) => deps.runnable(entry, request);
  const picked = pickNext(route.next, { provider }, failure, runnable);
  if (!picked) return false;
  deps.log(
    `generation job ${job.id} moves from ${request.model.model} to ${picked.entry.model}: ${failure.reason}`,
  );
  return deps
    .fallBack(
      job,
      { to: picked.entry, rest: picked.rest, reason: failure.reason },
      deps.runnable,
    )
    .catch((e) => {
      deps.log(`could not move ${job.id} down its route`, e);
      return false;
    });
}

export async function runJob(deps: WorkerDeps, job: ClaimedJob): Promise<void> {
  let callStarted = false;
  let paid = false;
  let provider: "google" | "openai" | undefined;
  let request: GenerationRequest | undefined;
  const renew = setInterval(() => {
    void deps.renewLease(job.id, job.leaseToken, deps.leaseSec).catch(() => {});
  }, deps.renewMs);
  try {
    if (deps.mode === "live" && (await deps.overCap(job.makerId))) {
      await deps.failJob(job.id, job.leaseToken, CAP_REACHED, {
        retry: false,
        mayBeCharged: false,
      });
      return;
    }
    const parsed = GenerationRequest.parse(job.request);
    request = parsed;
    provider = parsed.model.provider;
    const beforeCall = async () => {
      if (!(await deps.markCallStarted(job.id, job.leaseToken))) {
        throw new CallNotStarted();
      }
      callStarted = true;
    };
    const onPaid = () => {
      paid = true;
    };
    const result =
      parsed.kind === "video"
        ? await callVideo(deps, job, parsed, beforeCall, onPaid)
        : await callImage(deps, job, parsed, beforeCall, onPaid);
    if (!result.bytes) {
      throw new Error(
        result.refusal
          ? `${result.refusal}.`
          : "The provider returned no image.",
      );
    }
    const url = await storeWithRetries(deps, result.bytes, result.mime);
    await deps.completeJob(job.id, job.leaseToken, url);
  } catch (error) {
    const unanswered = callStarted && !paid && !hadResponse(error);
    const mayBeCharged = paid || unanswered;
    if (
      provider &&
      request &&
      !mayBeCharged &&
      !(error instanceof CallNotStarted) &&
      (await moveDown(deps, job, provider, request, error, callStarted))
    ) {
      return;
    }
    const retry =
      !mayBeCharged &&
      !(error instanceof CallNotStarted) &&
      retryDecision(job.attempt, error, job.maxAttempts).retry;
    // The provider's failure in words the maker can act on (Google's spend
    // cap, a rejected key), naming the other provider as the way out.
    const said = provider
      ? describeProviderError(provider, error)
      : errorMessage(error);
    const message = unanswered
      ? `The call got no answer (${said}); it may have been charged, so it was not retried.`
      : said;
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
