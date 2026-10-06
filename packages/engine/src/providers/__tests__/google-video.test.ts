import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateVideos = vi.fn();
const getVideosOperation = vi.fn();
const storeAsset = vi.fn(async () => "https://store/v.mp4");
const frameSizedTo = vi.fn(async () => Buffer.from("framed"));

vi.mock("@/providers/google/client", () => ({
  hasGoogleKey: () => true,
  googleApiKey: () => "test-key",
  getGenAI: () => ({
    models: { generateVideos },
    operations: { getVideosOperation },
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

const { googleVideoProvider, VEO_POLL_DEADLINE_MS } = await import(
  "@/providers/google/video"
);

const input = {
  startFrameAssetId: "https://store/scene.png",
  prompt: "Product video.",
  motion: "a subtle, slow push-in toward the product",
  durationSec: 8,
  negative: "text, people",
  model: {
    provider: "google" as const,
    model: "veo-3.1-fast-generate-preview",
    aspect: "9:16",
    resolution: "720p" as const,
  },
};

const done = (video: Record<string, unknown>) => ({
  done: true,
  response: { generatedVideos: [{ video }] },
});

const fetchMock = vi.fn(async () => new Response(Buffer.from("mp4")));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Veo animateBytes (the queue's video)", () => {
  it("sends the length, resolution, aspect and negative; downloads with the key; stores nothing", async () => {
    generateVideos.mockResolvedValue(done({ uri: "https://files/v:download" }));
    const order: string[] = [];
    generateVideos.mockImplementationOnce(async () => {
      order.push("create");
      return done({ uri: "https://files/v:download" });
    });
    const clip = await googleVideoProvider.animateBytes?.(input, {
      beforeCall: async () => {
        order.push("mark");
      },
    });
    expect(order).toEqual(["mark", "create"]);
    expect(frameSizedTo).toHaveBeenCalledWith(expect.anything(), 720, 1280);
    const call = generateVideos.mock.calls[0][0];
    expect(call.model).toBe("veo-3.1-fast-generate-preview");
    expect(call.image.mimeType).toBe("image/png");
    expect(call.config).toMatchObject({
      numberOfVideos: 1,
      aspectRatio: "9:16",
      durationSeconds: 8,
      resolution: "720p",
      personGeneration: "allow_adult",
      negativePrompt: "text, people",
      httpOptions: { timeout: 120_000 },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://files/v:download", {
      headers: { "x-goog-api-key": "test-key" },
      redirect: "follow",
    });
    expect(clip).toMatchObject({ seconds: 8, mime: "video/mp4" });
    expect(Buffer.from(clip?.bytes ?? []).toString()).toBe("mp4");
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it("1080p crops the frame to 1080 x 1920 and renders only 8 s", async () => {
    generateVideos.mockResolvedValue(done({ videoBytes: "bXA0" }));
    await googleVideoProvider.animateBytes?.({
      ...input,
      model: { ...input.model, resolution: "1080p" },
    });
    expect(frameSizedTo).toHaveBeenCalledWith(expect.anything(), 1080, 1920);
    await expect(
      googleVideoProvider.animateBytes?.({
        ...input,
        durationSec: 6,
        model: { ...input.model, resolution: "1080p" },
      }),
    ).rejects.toThrow("Veo 3.1 Fast renders 8 s at 1080p, not 6 s.");
  });

  it("a failed render throws without a status (it may be charged)", async () => {
    generateVideos.mockResolvedValue({
      done: true,
      error: { message: "internal" },
    });
    const error = await googleVideoProvider
      .animateBytes?.(input)
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(
      /Veo could not render the video \(internal\)/,
    );
    expect((error as { status?: unknown }).status).toBeUndefined();
  });

  it("a clip the safety filter blocked is a refusal with a status (not charged)", async () => {
    generateVideos.mockResolvedValue({
      done: true,
      response: {
        generatedVideos: [],
        raiMediaFilteredCount: 1,
        raiMediaFilteredReasons: ["people"],
      },
    });
    await expect(
      googleVideoProvider.animateBytes?.(input),
    ).rejects.toMatchObject({
      name: "VideoRefused",
      status: 422,
      message:
        "Google's safety filter blocked this video (not charged): people.",
    });
  });

  it("polls until done, tolerates a blip, and gives up at the deadline without a status", async () => {
    vi.useFakeTimers();
    generateVideos.mockResolvedValue({ done: false, name: "op-1" });
    getVideosOperation
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue({ done: false, name: "op-1" });
    const pending = googleVideoProvider
      .animateBytes?.(input)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(VEO_POLL_DEADLINE_MS + 20_000);
    const error = await pending;
    expect(String(error)).toMatch(/did not finish within 10 minutes/);
    expect((error as { status?: unknown }).status).toBeUndefined();
    expect(getVideosOperation.mock.calls.length).toBeGreaterThan(10);
  });

  it("a download that keeps failing after the render says it was paid", async () => {
    vi.useFakeTimers();
    generateVideos.mockResolvedValue(done({ uri: "https://files/v" }));
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const pending = googleVideoProvider
      .animateBytes?.(input)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await pending)).toMatch(
      /could not be downloaded.*it was paid/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
