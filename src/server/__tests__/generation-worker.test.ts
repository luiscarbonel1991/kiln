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

const claimed = (
  id: string,
  attempt = 1,
  route: unknown = null,
): ClaimedJob => ({
  id,
  leaseToken: `t-${id}`,
  attempt,
  maxAttempts: 2,
  makerId: "maker",
  projectId: "p",
  cardId: id,
  request,
  route,
  estimateMicros: 231_000,
  memberId: null,
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
    fallBack: vi.fn(async () => true),
    runnable: () => true,
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

// A provider that answers with an HTTP error after the call went out.
const answering = (error: Error) =>
  vi.fn(async (_input: unknown, options: EditOptions) => {
    await options.beforeCall?.();
    throw error;
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
      null,
    );
  });

  it("checks an image take before it lands, and lands it with its check", async () => {
    const check = {
      status: "passed" as const,
      engine: "fake",
      lines: [],
      problems: [],
      notes: [],
      checkedAt: "2026-11-02T10:00:00.000Z",
    };
    const checkTake = vi.fn(async () => check);
    const { d, calls } = deps({ checkTake });
    await runJob(d, claimed("a"));
    expect(calls).toEqual(["mark", "edit", "cost", "store", "complete"]);
    expect(checkTake).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ kind: "image" }),
      { url: "https://storage/out.png", bytes: bytes.bytes, mime: "image/png" },
    );
    expect(d.completeJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "https://storage/out.png",
      check,
    );
  });

  describe("the look at a scene", () => {
    const check = {
      status: "passed" as const,
      engine: "fake",
      lines: [],
      problems: [],
      notes: [],
      checkedAt: "2026-11-12T10:00:00.000Z",
    };
    const looked = (id: string): ClaimedJob => ({
      ...claimed(id),
      request: {
        ...request,
        look: { provider: "openai", model: "gpt-6.1-sol" },
      },
    });
    const usage = {
      inputTextTokens: 1500,
      inputImageTokens: 0,
      outputTokens: 300,
    };

    it("flags the take, fails its check and adds what the look cost", async () => {
      const lookAtScene = vi.fn(
        async (_m: unknown, _url: string, beforeCall: () => Promise<void>) => {
          await beforeCall();
          return {
            answer: {
              plausible: false,
              problems: [{ what: "The glass has no foot.", where: "centre" }],
            },
            model: "gpt-6.1-sol",
            usage,
          };
        },
      );
      const { d } = deps({ checkTake: vi.fn(async () => check), lookAtScene });
      await runJob(d, looked("a"));
      expect(lookAtScene).toHaveBeenCalledWith(
        { provider: "openai", model: "gpt-6.1-sol" },
        "https://storage/out.png",
        expect.any(Function),
      );
      // 1,500 in at $2 and 300 out at $10 per million: $0.006.
      expect(d.recordCost).toHaveBeenLastCalledWith("a", undefined, 6_000);
      expect(d.completeJob).toHaveBeenCalledWith(
        "a",
        "t-a",
        "https://storage/out.png",
        expect.objectContaining({
          status: "failed",
          problems: ["looks off: The glass has no foot."],
          look: expect.objectContaining({
            status: "flagged",
            model: "gpt-6.1-sol",
            costMicros: 6_000,
          }),
        }),
      );
    });

    it("a clear look keeps the verdict and says who looked", async () => {
      const { d } = deps({
        checkTake: vi.fn(async () => check),
        lookAtScene: vi.fn(async () => ({
          answer: { plausible: true, problems: [] },
          model: "gpt-6.1-sol",
          usage,
        })),
      });
      await runJob(d, looked("a"));
      expect(d.completeJob).toHaveBeenCalledWith(
        "a",
        "t-a",
        "https://storage/out.png",
        expect.objectContaining({
          status: "passed",
          look: expect.objectContaining({ status: "clear" }),
        }),
      );
    });

    it("a look the provider refuses lands the take unseen and costs nothing", async () => {
      const { d } = deps({
        checkTake: vi.fn(async () => check),
        lookAtScene: vi.fn(
          async (_m: unknown, _u: string, beforeCall: () => Promise<void>) => {
            await beforeCall();
            throw Object.assign(new Error("bad request"), { status: 400 });
          },
        ),
      });
      await runJob(d, looked("a"));
      expect(d.recordCost).toHaveBeenCalledTimes(1);
      expect(d.failJob).not.toHaveBeenCalled();
      expect(d.completeJob).toHaveBeenCalledWith(
        "a",
        "t-a",
        "https://storage/out.png",
        expect.objectContaining({
          status: "passed",
          look: expect.objectContaining({ status: "unseen" }),
        }),
      );
    });

    it("a look that got no answer may have been charged: its allowance is counted", async () => {
      const { d } = deps({
        checkTake: vi.fn(async () => check),
        lookAtScene: vi.fn(
          async (_m: unknown, _u: string, beforeCall: () => Promise<void>) => {
            await beforeCall();
            throw new Error("socket hang up");
          },
        ),
      });
      await runJob(d, looked("a"));
      // 3,000 in at $2 and 1,500 out at $10 per million: $0.021.
      expect(d.recordCost).toHaveBeenLastCalledWith("a", undefined, 21_000);
      expect(d.completeJob).toHaveBeenCalledWith(
        "a",
        "t-a",
        "https://storage/out.png",
        expect.objectContaining({
          look: expect.objectContaining({
            status: "unseen",
            costMicros: 21_000,
          }),
        }),
      );
    });

    it("nothing looks at a take whose request asks for none, or that Kiln does not check", async () => {
      const lookAtScene = vi.fn();
      const unasked = deps({
        checkTake: vi.fn(async () => check),
        lookAtScene,
      });
      await runJob(unasked.d, claimed("a"));
      const unchecked = deps({
        checkTake: vi.fn(async () => null),
        lookAtScene,
      });
      await runJob(unchecked.d, looked("b"));
      expect(lookAtScene).not.toHaveBeenCalled();
    });
  });

  it("a check that throws or stalls lands the take unchecked, never failed", async () => {
    const thrown = deps({
      checkTake: vi.fn(async () => {
        throw new Error("vision crashed");
      }),
    });
    await runJob(thrown.d, claimed("a"));
    expect(thrown.d.failJob).not.toHaveBeenCalled();
    expect(thrown.d.completeJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "https://storage/out.png",
      expect.objectContaining({
        status: "unchecked",
        unchecked: "the check could not run",
      }),
    );
    const stalled = deps({
      checkTake: () => new Promise(() => {}),
      checkTimeoutMs: 5,
    });
    await runJob(stalled.d, claimed("b"));
    expect(stalled.d.completeJob).toHaveBeenCalledWith(
      "b",
      "t-b",
      "https://storage/out.png",
      expect.objectContaining({ unchecked: "the check took too long" }),
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
      null,
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

describe("runJob along a route", () => {
  const flash = {
    provider: "google" as const,
    model: "gemini-3.1-flash-image",
  };
  const older = {
    provider: "openai" as const,
    model: "gpt-image-1.5",
    quality: "medium" as const,
  };
  const routed = (id: string, next: unknown[]) =>
    claimed(id, 1, { next, switched: [] });

  it("an answered failure moves to the next model instead of failing", async () => {
    const { d, editBytes } = deps();
    editBytes.mockImplementationOnce(
      answering(Object.assign(new Error("busy"), { status: 503 })),
    );
    await runJob(d, routed("a", [flash]));
    expect(d.fallBack).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      { to: flash, rest: [], reason: "OpenAI answered 503" },
      d.runnable,
    );
    expect(d.failJob).not.toHaveBeenCalled();
  });

  it("a rejected key skips the rest of that provider", async () => {
    const { d, editBytes } = deps();
    editBytes.mockImplementationOnce(
      answering(Object.assign(new Error("bad key"), { status: 401 })),
    );
    await runJob(d, routed("a", [older, flash]));
    expect(d.fallBack).toHaveBeenCalledWith(
      expect.anything(),
      { to: flash, rest: [], reason: "OpenAI rejected the API key" },
      d.runnable,
    );
  });

  it("a call with no answer stays final: it may have been charged", async () => {
    const { d, editBytes } = deps();
    editBytes.mockImplementationOnce(
      answering(new Error("Request timed out.")),
    );
    await runJob(d, routed("a", [flash]));
    expect(d.fallBack).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      expect.stringContaining("may have been charged"),
      { retry: false, mayBeCharged: true },
    );
  });

  it("a paid answer without an image never moves: one charged call per frame", async () => {
    const { d, editBytes } = deps();
    editBytes.mockImplementationOnce(async (_input, options) => {
      await options.beforeCall?.();
      return { ...bytes, bytes: null };
    });
    await runJob(d, routed("a", [flash]));
    expect(d.fallBack).not.toHaveBeenCalled();
    expect(d.failJob).toHaveBeenCalledWith(
      "a",
      "t-a",
      "The provider returned no image.",
      { retry: false, mayBeCharged: true },
    );
  });

  it("a bad request stops; so does a route with nothing that may run", async () => {
    const bad = deps();
    bad.editBytes.mockImplementationOnce(
      answering(Object.assign(new Error("rejected"), { status: 400 })),
    );
    await runJob(bad.d, routed("a", [flash]));
    expect(bad.d.fallBack).not.toHaveBeenCalled();

    const none = deps({ runnable: () => false });
    none.editBytes.mockImplementationOnce(
      answering(Object.assign(new Error("busy"), { status: 503 })),
    );
    await runJob(none.d, routed("a", [flash]));
    expect(none.d.fallBack).not.toHaveBeenCalled();
    expect(none.d.failJob).toHaveBeenCalledWith("a", "t-a", "busy", {
      retry: true,
      mayBeCharged: false,
    });
  });

  it("a move that could not be written fails the job as usual", async () => {
    const { d, editBytes } = deps({ fallBack: vi.fn(async () => false) });
    editBytes.mockImplementationOnce(
      answering(Object.assign(new Error("busy"), { status: 503 })),
    );
    await runJob(d, routed("a", [flash]));
    expect(d.failJob).toHaveBeenCalledWith("a", "t-a", "busy", {
      retry: true,
      mayBeCharged: false,
    });
  });

  it("over the monthly cap, nothing runs and nothing moves", async () => {
    const { d, calls } = deps({ overCap: vi.fn(async () => true) });
    await runJob(d, routed("a", [flash]));
    expect(calls).not.toContain("edit");
    expect(d.fallBack).not.toHaveBeenCalled();
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
      null,
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

  it("a clip whose provider reports its usage is costed from it", async () => {
    const usage = {
      inputTextTokens: 133,
      inputImageTokens: 1100,
      outputTokens: 28960,
      outputTextTokens: 352,
    };
    const { d } = videoDeps(async (options) => {
      await options.beforeCall?.();
      return {
        ...clip,
        model: "gemini-omni-1.1-flash",
        seconds: 5,
        usage,
      };
    });
    await runJob(d, {
      ...videoJob(),
      request: {
        ...videoRequest,
        durationSec: 5,
        model: { ...videoRequest.model, model: "gemini-omni-1.1-flash" },
      },
    });
    // 1,233 in at $1.50, 28,960 video at $17.50 and 352 thinking at $9 per 1M.
    expect(d.recordCost).toHaveBeenCalledWith(
      "v",
      { seconds: 5, resolution: "720p", tokens: usage },
      511_818,
    );
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

// A queued job runs as whoever queued it, read when it runs: the worker
// hands each claimed job to `asMaker`, which says whether its starter is
// still on the team. One who left has the job ended before anything else,
// at no cost, in both modes.
describe("a job whose starter is no longer on the team", () => {
  const LEFT =
    "Not run: the person who queued it is no longer on the team, so nothing was spent.";
  const flash = {
    provider: "google" as const,
    model: "gemini-3.1-flash-image",
  };

  const runOnce = async (
    mode: "live" | "mock",
    job: ClaimedJob,
    starter: "here" | "left",
  ) => {
    const queue = [job];
    const asMaker = vi.fn(
      async (
        _job: ClaimedJob,
        work: (starter: "here" | "left") => Promise<unknown>,
      ) => work(starter),
    );
    const made = deps({
      mode,
      claimJobs: vi.fn(async (_mode, limit) => queue.splice(0, limit)),
      asMaker: asMaker as unknown as WorkerDeps["asMaker"],
    });
    const worker = createWorker(made.d);
    workers.push(worker);
    worker.wake();
    await worker.idle();
    return { ...made, asMaker };
  };

  it("the worker hands the claimed job itself to run as its starter", async () => {
    const job = { ...claimed("a"), memberId: "m-bob" };
    const { asMaker, d } = await runOnce("live", job, "here");
    expect(asMaker).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", makerId: "maker", memberId: "m-bob" }),
      expect.any(Function),
    );
    expect(d.completeJob).toHaveBeenCalledTimes(1);
  });

  for (const mode of ["live", "mock"] as const) {
    it(`in ${mode} mode it never reaches the provider, and ends once, unretried, with nothing spent`, async () => {
      const job = {
        ...claimed("a", 1, { next: [flash], switched: [] }),
        memberId: "m-bob",
      };
      const { d, editBytes, calls } = await runOnce(mode, job, "left");
      expect(editBytes).not.toHaveBeenCalled();
      expect(calls).not.toContain("mark");
      expect(d.markCallStarted).not.toHaveBeenCalled();
      expect(d.overCap).not.toHaveBeenCalled();
      expect(d.fallBack).not.toHaveBeenCalled();
      expect(d.completeJob).not.toHaveBeenCalled();
      expect(d.failJob).toHaveBeenCalledTimes(1);
      expect(vi.mocked(d.failJob).mock.calls[0].slice(0, 4)).toEqual([
        "a",
        "t-a",
        LEFT,
        { retry: false, mayBeCharged: false },
      ]);
    });
  }
});

// A job whose starter has no key they can use for its provider when it runs
// is refused before the call: a saved route moves it as any missing key
// does; with nowhere to go it ends unstarted, in words that name no one.
describe("a job with no key in reach when it runs", () => {
  const flash = {
    provider: "google" as const,
    model: "gemini-3.1-flash-image",
  };
  const PERSON_OPENAI =
    "Not run: the person who queued it has no OpenAI key they can use now, so nothing was spent.";
  const PERSON_GOOGLE =
    "Not run: the person who queued it has no Google key they can use now, so nothing was spent.";
  const NO_PERSON =
    "Not run: the studio has no OpenAI key for the whole team it can use now, so nothing was spent.";

  const withKeys = (inReach: ("openai" | "google")[]) =>
    vi.fn((provider: "openai" | "google") => inReach.includes(provider));

  const failedWith = (d: WorkerDeps) =>
    vi.mocked(d.failJob).mock.calls.map((c) => c.slice(0, 4));

  it("with no saved route the provider is not called and the job ends, unretried, saying so", async () => {
    const keyInReach = withKeys([]);
    const { d, editBytes } = deps({ keyInReach } as Partial<WorkerDeps>);
    await runJob(d, { ...claimed("a", 1), memberId: "m-bob" });
    expect(keyInReach).toHaveBeenCalledWith("openai");
    expect(editBytes).not.toHaveBeenCalled();
    expect(d.markCallStarted).not.toHaveBeenCalled();
    expect(failedWith(d)).toEqual([
      ["a", "t-a", PERSON_OPENAI, { retry: false, mayBeCharged: false }],
    ]);
  });

  it("a Google job says Google", async () => {
    const { d } = deps({
      keyInReach: withKeys(["openai"]),
    } as Partial<WorkerDeps>);
    await runJob(d, {
      ...claimed("g", 1),
      memberId: "m-bob",
      request: {
        ...request,
        model: { ...request.model, provider: "google", model: flash.model },
      },
    });
    expect(failedWith(d)).toEqual([
      ["g", "t-g", PERSON_GOOGLE, { retry: false, mayBeCharged: false }],
    ]);
  });

  it("a saved route to a model whose provider has a key moves the job, with today's reason", async () => {
    const { d, editBytes } = deps({
      keyInReach: withKeys(["google"]),
      runnable: (entry) => entry.provider === "google",
    } as Partial<WorkerDeps>);
    await runJob(d, {
      ...claimed("a", 1, { next: [flash], switched: [] }),
      memberId: "m-bob",
    });
    expect(editBytes).not.toHaveBeenCalled();
    expect(d.fallBack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.fallBack).mock.calls[0][1]).toEqual({
      to: flash,
      rest: [],
      reason: "OpenAI has no API key",
    });
    expect(d.failJob).not.toHaveBeenCalled();
  });

  it("a job no person queued (a token's) says the studio has no key for the whole team", async () => {
    const { d, editBytes } = deps({
      keyInReach: withKeys([]),
    } as Partial<WorkerDeps>);
    await runJob(d, { ...claimed("a", 1), memberId: null });
    expect(editBytes).not.toHaveBeenCalled();
    expect(failedWith(d)).toEqual([
      ["a", "t-a", NO_PERSON, { retry: false, mayBeCharged: false }],
    ]);
  });

  it("in mock mode nothing checks a key, and the job runs", async () => {
    const keyInReach = withKeys([]);
    const { d, editBytes } = deps({
      mode: "mock",
      keyInReach,
    } as Partial<WorkerDeps>);
    await runJob(d, { ...claimed("a", 1), memberId: "m-bob" });
    expect(keyInReach).not.toHaveBeenCalled();
    expect(editBytes).toHaveBeenCalledTimes(1);
    expect(d.completeJob).toHaveBeenCalledTimes(1);
  });
});
