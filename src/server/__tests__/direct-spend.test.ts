import { afterEach, describe, expect, it, vi } from "vitest";

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

const { imageCall, videoCall, withDirectSpend } = await import(
  "@/server/direct-spend"
);

const VEO = {
  provider: "google" as const,
  model: "veo-3.1-fast-generate-preview",
};

const video = {
  assets: [{ id: "v", url: "https://x/v.mp4", mime: "video/mp4" }],
  provider: "google",
  model: VEO.model,
};

afterEach(() => vi.clearAllMocks());

describe("direct spend", () => {
  it("a video reserves its pinned max and records the seconds it generated", async () => {
    const result = await withDirectSpend(
      videoCall(VEO, 8),
      async (beforeCall) => {
        await beforeCall();
        return video;
      },
    );
    expect(result).toBe(video);
    expect(reserveDirectCall).toHaveBeenCalledWith({
      makerId: "maker-1",
      model: VEO.model,
      estimateMicros: 800_000,
    });
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage: undefined,
      actualMicros: 800_000,
    });
  });

  it("a length the model does not render has no price, so nothing is reserved", async () => {
    const call = vi.fn();
    await expect(withDirectSpend(videoCall(VEO, 12), call)).rejects.toThrow(
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
    await withDirectSpend(videoCall(VEO, 8), async () => video);
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
});
