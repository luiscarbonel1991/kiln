import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARGON_FREE_TIER } from "@/domain/__tests__/fixtures/google-quota";
import { quotaOut } from "@/domain/queue";

const create = vi.fn();
const get = vi.fn();
const cancel = vi.fn(async () => ({}));
const remove = vi.fn(async () => ({}));
const removeFile = vi.fn(async () => ({}));
const storeAsset = vi.fn(async () => "https://store/v.mp4");
const frameSizedTo = vi.fn(async () => Buffer.from("framed"));

vi.mock("@/providers/google/client", () => ({
  hasGoogleKey: () => true,
  googleApiKey: () => "test-key",
  getGenAI: () => ({
    interactions: { create, get, cancel, delete: remove },
    files: { delete: removeFile },
  }),
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: Buffer.from("frame"),
    base64: "",
    mime: "image/png",
  }),
  storeAsset,
}));
vi.mock("@/providers/frame", () => ({
  isFetchable: () => true,
  frameSizedTo,
  startFrameStandIn: async () => ({
    bytes: new Uint8Array(),
    mime: "image/png",
  }),
}));

const { googleVideoProvider, VIDEO_POLL_DEADLINE_MS } = await import(
  "@/providers/google/video"
);

const input = {
  startFrameAssetId: "https://store/scene.png",
  prompt: "Product video.",
  motion: "a subtle, slow push-in toward the product",
  durationSec: 5,
  negative: "text, people, speech, music",
  model: {
    provider: "google" as const,
    model: "gemini-omni-1.1-flash",
    aspect: "9:16",
    resolution: "720p" as const,
  },
};

const FILE =
  "https://generativelanguage.googleapis.com/v1beta/files/yqjinyacwobk:download?alt=media";
// What Google answered for a 5 s 720p clip on 2026-10-31.
const USAGE = {
  total_tokens: 30545,
  total_input_tokens: 1233,
  input_tokens_by_modality: [
    { modality: "text", tokens: 133 },
    { modality: "image", tokens: 1100 },
  ],
  total_output_tokens: 28960,
  output_tokens_by_modality: [{ modality: "video", tokens: 28960 }],
  total_thought_tokens: 352,
};
const running = { id: "i-1", status: "in_progress" };
const completed = {
  id: "i-1",
  status: "completed",
  usage: USAGE,
  output_video: { type: "video", uri: FILE },
};

const fetchMock = vi.fn(async () => new Response(Buffer.from("mp4")));

beforeEach(() => {
  vi.useFakeTimers();
  create.mockReset();
  get.mockReset();
  fetchMock.mockImplementation(async () => new Response(Buffer.from("mp4")));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settled<T>(promise: Promise<T> | undefined, ms = 30_000) {
  const caught = (promise ?? Promise.resolve(undefined)).catch(
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(ms);
  return caught;
}

describe("Gemini Omni animateBytes (the queue's video)", () => {
  it("sends the frame, the prompt and the format once, polls, downloads, forgets the render and stores nothing", async () => {
    const order: string[] = [];
    create.mockImplementationOnce(async () => {
      order.push("create");
      return running;
    });
    get.mockResolvedValue(completed);
    const clip = await settled(
      googleVideoProvider.animateBytes?.(input, {
        beforeCall: async () => {
          order.push("mark");
        },
      }),
    );
    expect(order).toEqual(["mark", "create"]);
    expect(frameSizedTo).toHaveBeenCalledWith(expect.anything(), 720, 1280);
    const [request, options] = create.mock.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: 120_000 });
    expect(request).toMatchObject({
      model: "gemini-omni-1.1-flash",
      response_modalities: ["video"],
      response_format: {
        type: "video",
        aspect_ratio: "9:16",
        resolution: "720p",
        duration: "5s",
        delivery: "uri",
      },
      background: true,
    });
    expect(request.input[0]).toEqual({
      type: "image",
      data: Buffer.from("framed").toString("base64"),
      mime_type: "image/png",
    });
    expect(request.input[1].text).toBe(
      "Product video. Motion: a subtle, slow push-in toward the product. Avoid: text, people, speech, music.",
    );
    expect(get).toHaveBeenCalledWith(
      "i-1",
      {},
      { maxRetries: 0, timeout: 30_000 },
    );
    expect(fetchMock).toHaveBeenCalledWith(FILE, {
      headers: { "x-goog-api-key": "test-key" },
      redirect: "follow",
    });
    expect(clip).toMatchObject({
      model: "gemini-omni-1.1-flash",
      seconds: 5,
      mime: "video/mp4",
      usage: {
        inputTextTokens: 133,
        inputImageTokens: 1100,
        outputTokens: 28960,
        outputTextTokens: 352,
      },
    });
    expect(remove).toHaveBeenCalledWith("i-1", {}, { maxRetries: 0 });
    expect(removeFile).toHaveBeenCalledWith({ name: "files/yqjinyacwobk" });
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it("16:9 crops the frame landscape; a length or resolution it does not render is refused before any call", async () => {
    create.mockResolvedValue(completed);
    await settled(
      googleVideoProvider.animateBytes?.({
        ...input,
        model: { ...input.model, aspect: "16:9" },
      }),
    );
    expect(frameSizedTo).toHaveBeenCalledWith(expect.anything(), 1280, 720);
    expect(create.mock.calls[0][0].response_format.aspect_ratio).toBe("16:9");
    create.mockClear();
    await expect(
      googleVideoProvider.animateBytes?.({ ...input, durationSec: 11 }),
    ).rejects.toThrow(
      "Gemini Omni Flash renders 3, 4, 5, 6, 7, 8, 9, 10 s at 720p, not 11 s.",
    );
    await expect(
      googleVideoProvider.animateBytes?.({
        ...input,
        model: { ...input.model, resolution: "1080p" },
      }),
    ).rejects.toThrow("Gemini Omni Flash does not render 1080p.");
    expect(create).not.toHaveBeenCalled();
  });

  it("a finished render with no video and nothing rendered is a refusal with a status", async () => {
    create.mockResolvedValue({
      id: "i-2",
      status: "completed",
      output_text: "I can't make this video.",
      usage: {
        ...USAGE,
        total_output_tokens: 0,
        output_tokens_by_modality: [],
      },
    });
    await expect(
      settled(googleVideoProvider.animateBytes?.(input)),
    ).resolves.toMatchObject({
      name: "VideoRefused",
      status: 422,
      message:
        "Gemini Omni made no video: I can't make this video.. No video was billed.",
    });
    expect(remove).toHaveBeenCalledWith("i-2", {}, { maxRetries: 0 });
  });

  it("a failure with nothing rendered was answered; one after rendering may be charged", async () => {
    create.mockResolvedValue({ id: "i-3", status: "failed" });
    expect(
      await settled(googleVideoProvider.animateBytes?.(input)),
    ).toMatchObject({
      status: 502,
      message: "Gemini Omni could not render the video (failed).",
    });
    create.mockResolvedValue({ id: "i-4", status: "incomplete", usage: USAGE });
    const error = await settled(googleVideoProvider.animateBytes?.(input));
    expect(String(error)).toMatch(
      /stopped \(incomplete\) after rendering; it may still be charged/,
    );
    expect((error as { status?: unknown }).status).toBeUndefined();
  });

  it("polls through a blip, and at the deadline cancels the render and throws without a status", async () => {
    create.mockResolvedValue(running);
    get
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue(running);
    const error = await settled(
      googleVideoProvider.animateBytes?.(input),
      VIDEO_POLL_DEADLINE_MS + 20_000,
    );
    expect(String(error)).toMatch(/did not finish within 10 minutes/);
    expect((error as { status?: unknown }).status).toBeUndefined();
    expect(get.mock.calls.length).toBeGreaterThan(10);
    expect(cancel).toHaveBeenCalledWith("i-1", {}, { maxRetries: 0 });
  });

  it("three poll errors in a row lose track of the render, without a status", async () => {
    create.mockResolvedValue(running);
    get.mockRejectedValue(new Error("socket hang up"));
    const error = await settled(
      googleVideoProvider.animateBytes?.(input),
      60_000,
    );
    expect(String(error)).toMatch(/Lost track of the Gemini Omni render/);
    expect((error as { status?: unknown }).status).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("a download that keeps failing says it was paid, and still forgets the render", async () => {
    create.mockResolvedValue(completed);
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(
      String(await settled(googleVideoProvider.animateBytes?.(input))),
    ).toMatch(/could not be downloaded.*it was paid/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalled();
  });

  it("a refused create keeps its status and body, so Kiln reads what ran out", async () => {
    const quota = Object.assign(
      new Error(`429 ${JSON.stringify(ARGON_FREE_TIER)}`),
      { status: 429 },
    );
    create.mockRejectedValue(quota);
    const error = await settled(googleVideoProvider.animateBytes?.(input));
    expect(error).toBe(quota);
    expect(quotaOut(error)).toMatchObject({ kind: "model" });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("Gemini Omni animate (the studio's video)", () => {
  it("stores the clip and carries its usage", async () => {
    create.mockResolvedValue(completed);
    const result = await settled(googleVideoProvider.animate(input));
    expect(storeAsset).toHaveBeenCalledWith(
      expect.anything(),
      "video/mp4",
      "videos",
    );
    expect(result).toMatchObject({
      provider: "google",
      model: "gemini-omni-1.1-flash",
      usage: { outputTokens: 28960 },
    });
  });
});
