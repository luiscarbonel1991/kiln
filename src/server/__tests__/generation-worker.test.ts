import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EditBytesResult,
  ImageProvider,
  VideoBytesResult,
  VideoProvider,
} from "@/providers/interfaces";
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

type EditOptions = { timeoutMs: number; beforeCall?: () => Promise<void> };

// The stub provider calls beforeCall right before its "paid request", like the
// OpenAI adapter does.
function deps(overrides: Partial<WorkerDeps> = {}) {
  const calls: string[] = [];
  const editBytes = vi.fn(
    async (_input: unknown, options: EditOptions): Promise<EditBytesResult> => {
      await options.beforeCall?.();
      calls.push("edit");
      return bytes;
    },
  );
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
    markCallStarted: vi.fn(async () => {
      calls.push("mark");
      return true;
    }),
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
    videoProvider: () => undefined,
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
    expect(calls).toEqual(["mark", "edit", "cost", "store", "complete"]);
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
    expect(d.failJob).toHaveBeenCalledWith("a", "t-a", "S3 down", {
      retry: false,
      mayBeCharged: true,
    });
  });

  // A provider that answers with an HTTP error after the call went out.
  const answering = (error: Error) =>
    vi.fn(async (_input: unknown, options: EditOptions) => {
      await options.beforeCall?.();
      throw error;
    });

  it("a failure the provider answered is retried once; a permanent one is not", async () => {
    const busy = Object.assign(new Error("busy"), { status: 503 });
    const one = deps();
    one.editBytes.mockImplementationOnce(answering(busy));
    await runJob(one.d, claimed("a", 1));
    expect(one.d.failJob).toHaveBeenCalledWith("a", "t-a", "busy", {
      retry: true,
      mayBeCharged: false,
    });

    const two = deps();
    two.editBytes.mockImplementationOnce(answering(busy));
    await runJob(two.d, claimed("a", 2));
    expect(two.d.failJob).toHaveBeenCalledWith("a", "t-a", "busy", {
      retry: false,
      mayBeCharged: false,
    });

    const three = deps();
    three.editBytes.mockImplementationOnce(
      answering(Object.assign(new Error("rejected"), { status: 400 })),
    );
    await runJob(three.d, claimed("a", 1));
    expect(three.d.failJob).toHaveBeenCalledWith("a", "t-a", "rejected", {
      retry: false,
      mayBeCharged: false,
    });
  });

  it("a call with no answer (timeout) may have been charged: final, never retried", async () => {
    const { d, editBytes } = deps();
    editBytes.mockImplementationOnce(
      answering(new Error("Request timed out.")),
    );
    await runJob(d, claimed("a", 1));
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      expect.stringContaining("may have been charged"),
      { retry: false, mayBeCharged: true },
    );
  });

  it("a failure before the call (fetching the reference) is still retried", async () => {
    const { d, editBytes } = deps();
    editBytes.mockRejectedValueOnce(new Error("fetch failed"));
    await runJob(d, claimed("a", 1));
    expect(d.markCallStarted).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith("a", "t-a", "fetch failed", {
      retry: true,
      mayBeCharged: false,
    });
  });

  it("no call mark, no call: a lost lease stops it before paying", async () => {
    const { d, calls } = deps({ markCallStarted: vi.fn(async () => false) });
    await runJob(d, claimed("a", 1));
    expect(calls).not.toContain("edit");
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      expect.stringContaining("nothing was spent"),
      { retry: false, mayBeCharged: false },
    );
  });

  it("a paid answer without an image keeps its cost and fails for good", async () => {
    const { d, editBytes } = deps();
    editBytes.mockImplementationOnce(async (_input, options) => {
      await options.beforeCall?.();
      return { ...bytes, bytes: null };
    });
    await runJob(d, claimed("a", 1));
    expect(d.recordCost).toHaveBeenCalledWith("a", bytes.usage, 129_000);
    expect(d.storeAsset).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "The provider returned no image.",
      { retry: false, mayBeCharged: true },
    );
  });

  it("failing to record the cost never loses the image", async () => {
    const { d } = deps({
      recordCost: vi.fn(async () => {
        throw new Error("db blip");
      }),
    });
    await runJob(d, claimed("a"));
    expect(d.completeJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "https://storage/out.png",
    );
  });

  it("a Gemini job records its measured cost from Gemini's usage", async () => {
    const gemini = {
      bytes: new Uint8Array([1]),
      mime: "image/png",
      model: "gemini-3.1-flash-image",
      usage: {
        inputTextTokens: 300,
        inputImageTokens: 1100,
        outputTokens: 1120,
        outputTextTokens: 80,
      },
    };
    const editBytes = vi.fn(async (_i: unknown, o: EditOptions) => {
      await o.beforeCall?.();
      return gemini;
    });
    const { d } = deps({
      provider: () => ({ id: "google", editBytes }) as unknown as ImageProvider,
    });
    await runJob(d, {
      ...claimed("g"),
      request: {
        ...request,
        model: { ...request.model, provider: "google", model: gemini.model },
      },
    });
    // 1,400 in at $0.50, 1,120 image out at $60, 80 text out at $3 per 1M.
    expect(d.recordCost).toHaveBeenCalledWith("g", gemini.usage, 68_140);
    expect(d.completeJob).toHaveBeenCalled();
  });

  it("a blocked Gemini image keeps its cost and says why", async () => {
    const editBytes = vi.fn(async (_i: unknown, o: EditOptions) => {
      await o.beforeCall?.();
      return {
        bytes: null,
        mime: "image/png",
        model: "gemini-3.1-flash-image",
        usage: {
          inputTextTokens: 300,
          inputImageTokens: 1100,
          outputTokens: 0,
        },
        refusal: "Gemini returned no image: IMAGE_SAFETY",
      };
    });
    const { d } = deps({
      provider: () => ({ id: "google", editBytes }) as unknown as ImageProvider,
    });
    await runJob(d, {
      ...claimed("b"),
      request: {
        ...request,
        model: {
          ...request.model,
          provider: "google",
          model: "gemini-3.1-flash-image",
        },
      },
    });
    expect(d.recordCost).toHaveBeenCalledWith("b", expect.anything(), 700);
    expect(d.failJob).toHaveBeenCalledWith(
      "b",
      "t-b",
      "Gemini returned no image: IMAGE_SAFETY.",
      { retry: false, mayBeCharged: true },
    );
  });

  it("over the monthly cap, a live job fails without calling the provider", async () => {
    const { d, editBytes } = deps({ overCap: vi.fn(async () => true) });
    await runJob(d, claimed("a"));
    expect(editBytes).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "This month's spending cap was reached.",
      { retry: false, mayBeCharged: false },
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

describe("video jobs", () => {
  const videoRequest = {
    kind: "video",
    startFrameUrl: "https://storage/cards/in-use.png",
    prompt: "animate the start frame",
    motion: "a subtle, slow push-in toward the product",
    durationSec: 8,
    negative: "text, people",
    model: {
      provider: "google",
      model: "veo-3.1-fast-generate-preview",
      aspect: "9:16",
      resolution: "720p",
      guidance: 7.5,
      strength: 0.65,
    },
  };
  const videoJob = (attempt = 1): ClaimedJob => ({
    ...claimed("v", attempt),
    request: videoRequest,
    estimateMicros: 800_000,
  });
  const clip: VideoBytesResult = {
    bytes: new Uint8Array([9, 9]),
    mime: "video/mp4",
    model: "veo-3.1-fast-generate-preview",
    seconds: 8,
  };

  function videoDeps(
    animate: (options: {
      beforeCall?: () => Promise<void>;
    }) => Promise<VideoBytesResult>,
    overrides: Partial<WorkerDeps> = {},
  ) {
    const animateBytes = vi.fn(
      async (
        _input: unknown,
        options: { beforeCall?: () => Promise<void> } = {},
      ) => animate(options),
    );
    const video = { id: "google", animateBytes } as unknown as VideoProvider;
    const made = deps({ videoProvider: () => video, ...overrides });
    return { ...made, animateBytes };
  }

  it("marks the call, records the seconds it rendered, stores the clip, completes", async () => {
    const { d, calls, animateBytes } = videoDeps(async (options) => {
      await options.beforeCall?.();
      return clip;
    });
    await runJob(d, videoJob());
    expect(animateBytes.mock.calls[0][0]).toMatchObject({
      startFrameAssetId: videoRequest.startFrameUrl,
      durationSec: 8,
      negative: "text, people",
    });
    expect(calls).toEqual(["mark", "cost", "store", "complete"]);
    // Veo 3.1 Fast at 720p: $0.10 a second.
    expect(d.recordCost).toHaveBeenCalledWith(
      "v",
      { seconds: 8, resolution: "720p" },
      800_000,
    );
    expect(d.storeAsset).toHaveBeenCalledWith(clip.bytes, "video/mp4", "cards");
  });

  it("a render that fails after its call is final: never a second paid render", async () => {
    const { d, animateBytes } = videoDeps(async (options) => {
      await options.beforeCall?.();
      throw new Error("Veo did not finish within 10 minutes");
    });
    await runJob(d, videoJob());
    expect(animateBytes).toHaveBeenCalledTimes(1);
    expect(d.failJob).toHaveBeenCalledWith(
      "v",
      "t-v",
      expect.stringContaining("may have been charged"),
      { retry: false, mayBeCharged: true },
    );
  });

  it("a clip the provider refused (safety filter) counts nothing and is not retried", async () => {
    const { d, animateBytes } = videoDeps(async (options) => {
      await options.beforeCall?.();
      throw Object.assign(
        new Error(
          "Google's safety filter blocked this video (not charged): people.",
        ),
        { name: "VideoRefused", status: 422 },
      );
    });
    await runJob(d, videoJob());
    expect(animateBytes).toHaveBeenCalledTimes(1);
    expect(d.failJob).toHaveBeenCalledWith(
      "v",
      "t-v",
      "Google's safety filter blocked this video (not charged): people.",
      { retry: false, mayBeCharged: false },
    );
  });

  it("a canceled job never starts its render", async () => {
    const render = vi.fn();
    const { d } = videoDeps(
      async (options) => {
        await options.beforeCall?.();
        render();
        return clip;
      },
      { markCallStarted: vi.fn(async () => false) },
    );
    await runJob(d, videoJob());
    expect(render).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith("v", "t-v", expect.any(String), {
      retry: false,
      mayBeCharged: false,
    });
  });
});
