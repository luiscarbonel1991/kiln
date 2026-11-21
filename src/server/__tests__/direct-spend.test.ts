import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextResult } from "@/providers/interfaces";
import type { GenerationResult } from "@/providers/types";

const reserveDirectCall = vi.fn(async (): Promise<string> => "row-1");
const markDirectCall = vi.fn(async () => {});
const closeDirectCall = vi.fn(async () => {});
const unlisted = vi.hoisted(() => ({
  found: {} as Record<string, { models: string[]; at: string }>,
}));
const readUnlisted = vi.fn(async (_makerId: string) => unlisted.found);

vi.mock("@/lib/db", () => ({
  hasDatabase: () => true,
  // The studio's owner, whom a member over the limit is told to ask.
  db: {
    member: {
      findMany: async () => [{ role: "owner", user: { name: "Ana Ruiz" } }],
    },
  },
}));
const mode = vi.hoisted(() => ({ current: "live" as "live" | "mock" }));
vi.mock("@/providers/mode", () => ({ providerMode: () => mode.current }));
// Fixture keys: which providers have a key in reach. Nothing here can pay.
const keys = vi.hoisted(() => ({ openai: true, google: true }));
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: (provider: "openai" | "google") => keys[provider],
}));
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
  readUnlisted,
}));

const { imageCall, openDirectCall, textCall, videoCall, withDirectSpend } =
  await import("@/server/direct-spend");
const { withProviderKeys } = await import("@/providers/keys");
const { fallbackAfter } = await import("@/domain/model-routing");

const OMNI = {
  provider: "google" as const,
  model: "gemini-omni-1.1-flash",
};

const video: GenerationResult = {
  assets: [{ id: "v", url: "https://x/v.mp4", mime: "video/mp4" }],
  provider: "google",
  model: OMNI.model,
};

afterEach(() => {
  vi.clearAllMocks();
  keys.openai = true;
  keys.google = true;
  mode.current = "live";
});

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

// A provider with no key in reach cannot take the call: it is refused first,
// in the reader's words, before the unlisted models are read and before
// anything is reserved. The app runs every entry point inside its maker's
// keys, so the cases that read the owner's words run inside a scope.
describe("a direct call with no key in reach", () => {
  const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };
  const member = {
    id: "maker-1",
    member: { id: "m1", userId: "u1", role: "member" as const },
  };
  const owner = {
    id: "maker-1",
    member: { id: "o1", userId: "u0", role: "owner" as const },
  };
  const OWNERS = "OpenAI has no API key: add one in Settings → Providers.";
  const nothingHappened = (call?: { mock: { calls: unknown[] } }) => {
    expect(readUnlisted).not.toHaveBeenCalled();
    expect(reserveDirectCall).not.toHaveBeenCalled();
    expect(markDirectCall).not.toHaveBeenCalled();
    expect(closeDirectCall).not.toHaveBeenCalled();
    if (call) expect(call.mock.calls).toEqual([]);
  };

  it("a member is refused before anything is read or reserved, and told whom to ask", async () => {
    keys.openai = false;
    const call = vi.fn(
      async (): Promise<TextResult<string>> => ({
        value: "",
        model: LUNA.model,
      }),
    );
    await expect(
      withProviderKeys({}, () =>
        withDirectSpend(member, textCall<string>(LUNA, "chatTurn"), call),
      ),
    ).rejects.toMatchObject({
      name: "ProviderKeyMissing",
      provider: "openai",
      message: "You have no access to an OpenAI key; ask Ana.",
    });
    nothingHappened(call);
    await expect(
      withProviderKeys({}, () =>
        openDirectCall(member, textCall<string>(LUNA, "chatTurn")),
      ),
    ).rejects.toMatchObject({
      name: "ProviderKeyMissing",
      message: "You have no access to an OpenAI key; ask Ana.",
    });
    nothingHappened();
  });

  it("a member's video on a provider with no key names that provider", async () => {
    keys.google = false;
    const call = vi.fn(async () => video);
    await expect(
      withProviderKeys({}, () =>
        withDirectSpend(member, videoCall(OMNI, 8), call),
      ),
    ).rejects.toMatchObject({
      name: "ProviderKeyMissing",
      provider: "google",
      message: "You have no access to a Google key; ask Ana.",
    });
    nothingHappened(call);
  });

  it("the owner and work with no person read where to add the key, with no .env in it", async () => {
    keys.openai = false;
    for (const reader of [owner, { id: "maker-1" }]) {
      const call = vi.fn(async () => video);
      const refused = withProviderKeys({}, () =>
        withDirectSpend(
          reader,
          imageCall({ provider: "openai", model: "gpt-image-2" }, "1:1"),
          call,
        ),
      );
      await expect(refused).rejects.toMatchObject({
        name: "ProviderKeyMissing",
        provider: "openai",
        message: OWNERS,
      });
      nothingHappened(call);
    }
  });

  it("a script outside any maker's keys is told which variable to set", async () => {
    keys.openai = false;
    await expect(
      openDirectCall({ id: "maker-1" }, textCall<string>(LUNA, "chatTurn")),
    ).rejects.toMatchObject({
      name: "ProviderKeyMissing",
      message: "OpenAI has no API key: set OPENAI_API_KEY.",
    });
    nothingHappened();
  });

  it("the refusal is one a saved route moves past, to another provider's model", async () => {
    keys.openai = false;
    for (const reader of [member, owner]) {
      const error = await withProviderKeys({}, () =>
        openDirectCall(reader, textCall<string>(LUNA, "chatTurn")),
      ).catch((e: unknown) => e);
      expect(fallbackAfter("openai", error, { callStarted: false })).toEqual({
        move: "provider",
        reason: "OpenAI has no API key",
      });
    }
  });

  it("the other provider's call still runs and reserves", async () => {
    keys.openai = false;
    await withDirectSpend(member, videoCall(OMNI, 8), async (beforeCall) => {
      await beforeCall();
      return video;
    });
    expect(reserveDirectCall).toHaveBeenCalledTimes(1);
  });

  it("a model with no pinned price is still refused for its price first", async () => {
    keys.openai = false;
    await expect(
      withDirectSpend(
        member,
        imageCall({ provider: "openai", model: "gpt-image-0" }, "1:1"),
        vi.fn(),
      ),
    ).rejects.toThrow("No pinned price for gpt-image-0");
    nothingHappened();
  });

  it("a mock run checks no key and reserves nothing", async () => {
    keys.google = false;
    mode.current = "mock";
    const result = await withDirectSpend(
      member,
      videoCall(OMNI, 8),
      async () => video,
    );
    expect(result).toBe(video);
    nothingHappened();
  });
});
