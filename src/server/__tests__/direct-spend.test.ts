import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationResult } from "@/providers/types";

const reserveDirectCall = vi.fn(async (): Promise<string> => "row-1");
const markDirectCall = vi.fn(async () => {});
const closeDirectCall = vi.fn(async () => {});
const unlisted = vi.hoisted(() => ({
  found: {} as Record<string, { models: string[]; at: string }>,
}));

vi.mock("@/lib/db", () => ({
  hasDatabase: () => true,
  // The studio's owner, whom a member over the limit is told to ask.
  db: {
    member: {
      findMany: async () => [{ role: "owner", user: { name: "Ana Ruiz" } }],
    },
  },
}));
vi.mock("@/providers/mode", () => ({ providerMode: () => "live" }));
const { QueueRefusal } = vi.hoisted(() => ({
  QueueRefusal: class QueueRefusal extends Error {
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/generation-repository", () => ({
  QueueRefusal,
  reserveDirectCall,
  markDirectCall,
  closeDirectCall,
  readUnlisted: async () => unlisted.found,
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
      { id: "maker-1" },
      videoCall(OMNI, 8),
      async (beforeCall) => {
        await beforeCall();
        return video;
      },
    );
    expect(result).toBe(video);
    // Work with no person records none.
    expect(reserveDirectCall).toHaveBeenCalledWith({
      makerId: "maker-1",
      provider: "google",
      model: OMNI.model,
      estimateMicros: 821_200,
      memberId: null,
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
    await withDirectSpend(
      { id: "maker-1" },
      videoCall(OMNI, 5),
      async (beforeCall) => {
        await beforeCall();
        return { ...video, usage };
      },
    );
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage,
      actualMicros: 511_818,
    });
  });

  it("a model its provider no longer lists is refused before anything is reserved", async () => {
    unlisted.found = {
      google: { models: [OMNI.model], at: "2026-10-31T23:00:00.000Z" },
    };
    const call = vi.fn();
    await expect(
      withDirectSpend({ id: "maker-1" }, videoCall(OMNI, 8), call),
    ).rejects.toMatchObject({
      name: "CapabilityError",
      message:
        "Google no longer offers Gemini Omni Flash (its model list, checked 2026-10-31) — pick another model.",
    });
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    unlisted.found = {};
  });

  it("a length the model does not render has no price, so nothing is reserved", async () => {
    const call = vi.fn();
    await expect(
      withDirectSpend({ id: "maker-1" }, videoCall(OMNI, 12), call),
    ).rejects.toThrow("No pinned price");
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("an image model without a pinned price reserves nothing (never $0)", async () => {
    await expect(
      withDirectSpend(
        { id: "maker-1" },
        imageCall({ provider: "openai", model: "gpt-image-0" }, "1:1"),
        vi.fn(),
      ),
    ).rejects.toThrow("No pinned price for gpt-image-0");
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(
      imageCall({ provider: "openai", model: "gpt-image-2" }, "4:5")
        .estimateMax,
    ).toBe(0.0653);
  });

  it("a call that never went out (a stub) records no cost", async () => {
    await withDirectSpend(
      { id: "maker-1" },
      videoCall(OMNI, 8),
      async () => video,
    );
    expect(closeDirectCall).toHaveBeenCalledWith("row-1", {
      usage: undefined,
      actualMicros: null,
    });
  });

  it("a render with no answer after its call counts at the estimate", async () => {
    await expect(
      withDirectSpend(
        { id: "maker-1" },
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
    const direct = await openDirectCall(
      { id: "maker-1" },
      textCall<string>(luna, "chatTurn"),
    );
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

  // The person behind the session reaches the reserved row, for a
  // call and for one opened around a stream (the chat's model steps).
  it("a direct call by a person reserves its row in their name", async () => {
    const session = {
      id: "maker-1",
      member: { id: "m1", userId: "u1", role: "member" as const },
    };
    await withDirectSpend(session, videoCall(OMNI, 8), async (beforeCall) => {
      await beforeCall();
      return video;
    });
    expect(reserveDirectCall).toHaveBeenCalledWith({
      makerId: "maker-1",
      provider: "google",
      model: OMNI.model,
      estimateMicros: 821_200,
      memberId: "m1",
    });
    vi.clearAllMocks();
    const luna = { provider: "openai" as const, model: "gpt-6-luna" };
    await openDirectCall(session, textCall<string>(luna, "chatTurn"));
    expect(reserveDirectCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-6-luna", memberId: "m1" }),
    );
  });

  // The cap's refusal, as the reservation throws it: a member reads whom to
  // ask and no amount; the owner reads it as it was.
  it("a member over this month's limit is told whom to ask", async () => {
    const over = new QueueRefusal(
      "cap",
      "This generation would go over this month's spending cap.",
    );
    reserveDirectCall.mockRejectedValue(over);
    const luna = { provider: "openai" as const, model: "gpt-6-luna" };
    const call = textCall<string>(luna, "chatTurn");
    const member = {
      id: "maker-1",
      member: { id: "m1", userId: "u1", role: "member" as const },
    };
    await expect(openDirectCall(member, call)).rejects.toMatchObject({
      reason: "cap",
      message: "Over this month's limit: ask Ana.",
    });
    const owner = {
      id: "maker-1",
      member: { id: "o1", userId: "u0", role: "owner" as const },
    };
    await expect(openDirectCall(owner, call)).rejects.toBe(over);
    await expect(openDirectCall({ id: "maker-1" }, call)).rejects.toBe(over);
    reserveDirectCall.mockReset();
    reserveDirectCall.mockImplementation(async () => "row-1");
  });

  it("a stream that answered an HTTP error counts nothing", async () => {
    const luna = { provider: "openai" as const, model: "gpt-6-luna" };
    const direct = await openDirectCall(
      { id: "maker-1" },
      textCall<string>(luna, "chatTurn"),
    );
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
