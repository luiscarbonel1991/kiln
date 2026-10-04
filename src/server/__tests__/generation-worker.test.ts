import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditBytesResult, ImageProvider } from "@/providers/interfaces";
import type { ClaimedJob } from "@/server/generation-repository";
import {
  createWorker,
  runJob,
  type WorkerDeps,
} from "@/server/generation-worker";

const request = {
  kind: "image",
  masterAssetUrl: "https://stub.local/plate.png",
  prompt: "a scene",
  imageInputs: [],
  negative: "",
  model: {
    provider: "openai",
    model: "gpt-image-2",
    aspect: "1:1",
    guidance: 7.5,
    strength: 0.65,
  },
};

const claimed = (id: string, attempt = 1): ClaimedJob => ({
  id,
  leaseToken: `t-${id}`,
  attempt,
  maxAttempts: 2,
  makerId: "maker",
  projectId: "p",
  cardId: id,
  request,
  estimateMicros: 231_000,
});

const bytes: EditBytesResult = {
  bytes: new Uint8Array([1, 2, 3]),
  mime: "image/png",
  model: "gpt-image-2",
  usage: { inputTextTokens: 200, inputImageTokens: 1000, outputTokens: 4000 },
};

function deps(overrides: Partial<WorkerDeps> = {}) {
  const calls: string[] = [];
  const editBytes = vi.fn(async () => {
    calls.push("edit");
    return bytes;
  });
  const provider = { id: "openai", editBytes } as unknown as ImageProvider;
  const d: WorkerDeps = {
    mode: "live",
    concurrency: 2,
    leaseSec: 120,
    renewMs: 60_000,
    sweepMs: 60_000,
    callTimeoutMs: 180_000,
    claimJobs: vi.fn(async () => []),
    renewLease: vi.fn(async () => true),
    recordCost: vi.fn(async () => {
      calls.push("cost");
    }),
    completeJob: vi.fn(async () => {
      calls.push("complete");
      return true;
    }),
    failJob: vi.fn(async () => true),
    requeueExpired: vi.fn(async () => 0),
    overCap: vi.fn(async () => false),
    provider: () => provider,
    storeAsset: vi.fn(async () => {
      calls.push("store");
      return "https://storage/out.png";
    }),
    log: () => {},
    ...overrides,
  };
  return { d, calls, editBytes };
}

let workers: { stop(): void }[] = [];
afterEach(() => {
  for (const w of workers) w.stop();
  workers = [];
});

describe("runJob", () => {
  it("records the cost before storing, then completes", async () => {
    const { d, calls } = deps();
    await runJob(d, claimed("a"));
    expect(calls).toEqual(["edit", "cost", "store", "complete"]);
    expect(d.recordCost).toHaveBeenCalledWith("a", bytes.usage, 129_000);
    expect(d.completeJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "https://storage/out.png",
    );
  });

  it("retries storage in-process, never the paid call", async () => {
    let tries = 0;
    const { d, editBytes } = deps({
      storeAsset: vi.fn(async () => {
        tries++;
        if (tries === 1) throw new Error("S3 hiccup");
        return "https://storage/out.png";
      }),
    });
    await runJob(d, claimed("a"));
    expect(editBytes).toHaveBeenCalledTimes(1);
    expect(d.completeJob).toHaveBeenCalled();
  });

  it("a storage failure after a paid call is final: cost kept, no retry", async () => {
    const { d, editBytes } = deps({
      storeAsset: vi.fn(async () => {
        throw new Error("S3 down");
      }),
    });
    await runJob(d, claimed("a"));
    expect(editBytes).toHaveBeenCalledTimes(1);
    expect(d.recordCost).toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith("a", "t-a", "S3 down", false);
  });

  it("a transient provider failure is retried once; a permanent one is not", async () => {
    const transient = Object.assign(new Error("busy"), { status: 503 });
    const one = deps();
    one.editBytes.mockRejectedValueOnce(transient);
    await runJob(one.d, claimed("a", 1));
    expect(one.d.failJob).toHaveBeenCalledWith("a", "t-a", "busy", true);

    const two = deps();
    two.editBytes.mockRejectedValueOnce(transient);
    await runJob(two.d, claimed("a", 2));
    expect(two.d.failJob).toHaveBeenCalledWith("a", "t-a", "busy", false);

    const three = deps();
    three.editBytes.mockRejectedValueOnce(
      Object.assign(new Error("rejected"), { status: 400 }),
    );
    await runJob(three.d, claimed("a", 1));
    expect(three.d.failJob).toHaveBeenCalledWith("a", "t-a", "rejected", false);
  });

  it("over the monthly cap, a live job fails without calling the provider", async () => {
    const { d, editBytes } = deps({ overCap: vi.fn(async () => true) });
    await runJob(d, claimed("a"));
    expect(editBytes).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "This month's spending cap was reached.",
      false,
    );
  });
});

describe("createWorker", () => {
  it("runs the queue to the end, never more than `concurrency` at once", async () => {
    const queue = ["a", "b", "c", "d", "e"].map((id) => claimed(id));
    let running = 0;
    let peak = 0;
    const { d } = deps({
      claimJobs: vi.fn(async (_mode, limit) => queue.splice(0, limit)),
      storeAsset: vi.fn(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return "https://storage/out.png";
      }),
    });
    const worker = createWorker(d);
    workers.push(worker);
    worker.wake();
    await worker.idle();
    expect(d.completeJob).toHaveBeenCalledTimes(5);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("a claim error does not stop the worker; the next wake claims again", async () => {
    const queue = [claimed("a")];
    let first = true;
    const { d } = deps({
      claimJobs: vi.fn(async (_mode, limit) => {
        if (first) {
          first = false;
          throw new Error("db blip");
        }
        return queue.splice(0, limit);
      }),
    });
    const worker = createWorker(d);
    workers.push(worker);
    worker.wake();
    await worker.idle();
    worker.wake();
    await worker.idle();
    expect(d.completeJob).toHaveBeenCalledTimes(1);
  });

  it("a wake while claiming is not lost", async () => {
    const queue: ClaimedJob[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { d } = deps({
      claimJobs: vi.fn(async (_mode, limit) => {
        await gate;
        return queue.splice(0, limit);
      }),
    });
    const worker = createWorker(d);
    workers.push(worker);
    worker.wake();
    queue.push(claimed("late"));
    worker.wake();
    release();
    await worker.idle();
    expect(d.completeJob).toHaveBeenCalledWith(
      "late",
      "t-late",
      "https://storage/out.png",
    );
  });
});
