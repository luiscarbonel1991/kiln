import { afterEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const retrieve = vi.fn();
const downloadContent = vi.fn();
const storeAsset = vi.fn(async () => "https://stub.local/videos/v.mp4");

vi.mock("@/providers/openai/client", () => ({
  hasOpenAIKey: () => true,
  getOpenAI: () => ({ videos: { create, retrieve, downloadContent } }),
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: vi.fn(),
  storeAsset,
}));

const { openaiVideoProvider, VIDEO_POLL_DEADLINE_MS } = await import(
  "@/providers/openai/video"
);

// No start frame (a stub ref), so nothing is fetched or resized.
const input = {
  startFrameAssetId: "stub-frame",
  prompt: "a coaster on a table",
  motion: "slow push in",
  durationSec: 8,
  model: { provider: "openai" as const, model: "sora-2", aspect: "9:16" },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("openai animate (Sora)", () => {
  it("marks the call right before the paid create, which the SDK never retries", async () => {
    const order: string[] = [];
    const beforeCall = vi.fn(async () => {
      order.push("mark");
    });
    create.mockImplementation(async () => {
      order.push("create");
      return { id: "v1", status: "completed" };
    });
    downloadContent.mockResolvedValue(new Response("mp4"));
    const result = await openaiVideoProvider.animate(input, { beforeCall });
    expect(order).toEqual(["mark", "create"]);
    const [body, options] = create.mock.calls[0];
    expect(body).toMatchObject({ model: "sora-2", seconds: "8" });
    expect(options).toMatchObject({ maxRetries: 0 });
    expect(result.model).toBe("sora-2");
  });

  it("stops polling at the deadline: the render may still be charged", async () => {
    vi.useFakeTimers();
    create.mockResolvedValue({ id: "v2", status: "queued" });
    retrieve.mockResolvedValue({ id: "v2", status: "in_progress" });
    const run = openaiVideoProvider.animate(input);
    const outcome = expect(run).rejects.toThrow("may still be charged");
    await vi.advanceTimersByTimeAsync(VIDEO_POLL_DEADLINE_MS + 20_000);
    await outcome;
    expect(downloadContent).not.toHaveBeenCalled();
  });

  it("a failed render throws without an HTTP status", async () => {
    create.mockResolvedValue({
      id: "v3",
      status: "failed",
      error: { message: "moderation" },
    });
    const error = await openaiVideoProvider.animate(input).catch((e) => e);
    expect(error.message).toBe("moderation");
    expect(error.status).toBeUndefined();
  });
});
