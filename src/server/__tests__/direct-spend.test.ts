import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationResult } from "@/providers/types";

const reserveDirectCall = vi.fn(async () => "row-1");
const markDirectCall = vi.fn(async () => {});
const closeDirectCall = vi.fn(async () => {});

vi.mock("@/lib/db", () => ({ hasDatabase: () => true }));
vi.mock("@/providers/mode", () => ({ providerMode: () => "live" }));
vi.mock("@/server/generation-repository", () => ({
  reserveDirectCall,
  markDirectCall,
  closeDirectCall,
}));
vi.mock("@/server/maker-repository", () => ({
  getCurrentMaker: async () => ({ id: "maker-1" }),
}));

const { imageCall, openDirectCall, textCall, videoCall, withDirectSpend } =
  await import("@/server/direct-spend");

const OMNI = {
  provider: "google" as const,
  model: "gemini-omni-1.1-flash",
};

const video: GenerationResult = {
  assets: [{ id: "v", url: "https://x/v.mp4", mime: "video/mp4" }],
  provider: "google",
  model: OMNI.model,
};

afterEach(() => vi.clearAllMocks());

describe("direct spend", () => {
  it("a video reserves its pinned max and records the seconds it generated", async () => {
    const result = await withDirectSpend(
      videoCall(OMNI, 8),
      async (beforeCall) => {
        await beforeCall();
        return video;
      },
    );
    expect(result).toBe(video);
    expect(reserveDirectCall).toHaveBeenCalledWith({
      makerId: "maker-1",
      provider: "google",
      model: OMNI.model,
      estimateMicros: 821_200,
    });
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage: undefined,
      actualMicros: 821_200,
    });
  });

  it("a video that reports its usage records what it measured", async () => {
    const usage = {
      inputTextTokens: 133,
      inputImageTokens: 1100,
      outputTokens: 28960,
      outputTextTokens: 352,
    };
    await withDirectSpend(videoCall(OMNI, 5), async (beforeCall) => {
      await beforeCall();
      return { ...video, usage };
    });
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage,
      actualMicros: 511_818,
    });
  });

  it("a length the model does not render has no price, so nothing is reserved", async () => {
    const call = vi.fn();
    await expect(withDirectSpend(videoCall(OMNI, 12), call)).rejects.toThrow(
      "No pinned price",
    );
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("an image model without a pinned price reserves nothing (never $0)", async () => {
    await expect(
      withDirectSpend(
        imageCall({ provider: "openai", model: "gpt-image-0" }, "1:1"),
        vi.fn(),
      ),
    ).rejects.toThrow("No pinned price for gpt-image-0");
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(
      imageCall({ provider: "openai", model: "gpt-image-2" }, "4:5")
        .estimateMax,
    ).toBe(0.061);
  });

  it("a call that never went out (a stub) records no cost", async () => {
    await withDirectSpend(videoCall(OMNI, 8), async () => video);
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage: undefined,
      actualMicros: null,
    });
  });

  it("a render with no answer after its call counts at the estimate", async () => {
    await expect(
      withDirectSpend(
        imageCall({ provider: "openai", model: "gpt-image-2" }, "1:1"),
        async (beforeCall) => {
          await beforeCall();
          throw new Error("Sora did not finish");
        },
      ),
    ).rejects.toThrow();
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      error: "Sora did not finish",
      mayBeCharged: true,
    });
  });

  it("a call opened around a stream closes once, with its measured cost", async () => {
    const luna = { provider: "openai" as const, model: "gpt-6-luna" };
    const direct = await openDirectCall(textCall<string>(luna, "chatTurn"));
    expect(reserveDirectCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-6-luna" }),
    );
    await direct.beforeCall();
    expect(markDirectCall).toHaveBeenCalledWith("row-1");
    const usage = {
      inputTextTokens: 10_000,
      inputImageTokens: 0,
      outputTokens: 1_000,
    };
    await direct.done({ value: "", model: luna.model, usage });
    await direct.failed(new Error("late"));
    expect(closeDirectCall).toHaveBeenCalledTimes(1);
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage,
      actualMicros: 1_500,
    });
  });

  it("a stream that answered an HTTP error counts nothing", async () => {
    const luna = { provider: "openai" as const, model: "gpt-6-luna" };
    const direct = await openDirectCall(textCall<string>(luna, "chatTurn"));
    await direct.beforeCall();
    await direct.failed(
      Object.assign(new Error("Bad Request"), { status: 400 }),
    );
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      error: "Bad Request",
      mayBeCharged: false,
    });
  });
});
