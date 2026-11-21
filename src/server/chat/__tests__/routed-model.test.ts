import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARGON_FREE_TIER,
  fromChat,
} from "@/domain/__tests__/fixtures/google-quota";

const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };
const FLASH = { provider: "google" as const, model: "gemini-3.8-flash" };
const ARGON = { provider: "google" as const, model: "gemini-4-argon" };

const ROUTE = { candidates: [LUNA, FLASH], effort: "low" as const };
const asked: { id: string; effort: unknown }[] = [];
const opened: {
  model: string;
  beforeCall: ReturnType<typeof vi.fn>;
  done: ReturnType<typeof vi.fn>;
  failed: ReturnType<typeof vi.fn>;
}[] = [];
const openDirectCall = vi.fn(
  async (_maker: unknown, priced: { model: string }) => {
    const call = {
      model: priced.model,
      beforeCall: vi.fn(async () => {}),
      done: vi.fn(async () => {}),
      failed: vi.fn(async () => {}),
    };
    opened.push(call);
    return call;
  },
);
const models = new Map<string, LanguageModelV4>();

vi.mock("@/server/text-calls", () => ({
  textRunnable: () => () => true,
}));
vi.mock("@/server/direct-spend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/direct-spend")>()),
  openDirectCall,
}));
vi.mock("@/providers/registry", () => ({
  getChatModels: () => ({
    model: (id: string, effort: unknown) => {
      asked.push({ id, effort });
      const model = models.get(id);
      if (!model) throw new Error(`no fake for ${id}`);
      return model;
    },
  }),
}));

const { newLedger, routedChatModel } = await import(
  "@/server/chat/routed-model"
);

afterEach(() => {
  opened.length = 0;
  asked.length = 0;
  models.clear();
  vi.clearAllMocks();
});

const CALL: LanguageModelV4CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hola" }] }],
  maxOutputTokens: 50_000,
};

const answer = (text: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  {
    type: "finish",
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: {
        total: 10_000,
        noCache: 10_000,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: 1_000, text: 1_000, reasoning: 0 },
    },
  },
];

function streaming(
  parts: LanguageModelV4StreamPart[],
  seen?: LanguageModelV4CallOptions[],
) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      seen?.push(options);
      return { stream: simulateReadableStream({ chunks: parts }) };
    },
  });
}

async function read(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const parts: LanguageModelV4StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}

describe("the chat's routed model", () => {
  it("a step reserves under the cap, is marked before its request, and records what it cost", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    models.set(LUNA.model, streaming(answer("Hola."), seen));
    const ledger = newLedger();
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      projectId: "p1",
      ledger,
    });
    const { stream } = await model.doStream(CALL);
    await read(stream);
    expect(openDirectCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: LUNA.model, projectId: "p1" }),
    );
    expect(opened[0].beforeCall).toHaveBeenCalledTimes(1);
    expect(opened[0].done).toHaveBeenCalledWith({
      usage: {
        inputTextTokens: 10_000,
        inputImageTokens: 0,
        outputTokens: 1_000,
      },
    });
    expect(seen[0].maxOutputTokens).toBe(2_000);
    expect(ledger).toEqual({
      models: ["GPT-6 Luna · low"],
      moves: [],
      costMicros: 1_500,
    });
  });

  it("runs at the route's effort: the model is told, the step may write more, and its reservation counts it", async () => {
    // Gemini's price is dated: read it before Google's change.
    vi.useFakeTimers({
      now: new Date("2026-10-31T12:00:00Z"),
      toFake: ["Date"],
    });
    const seen: LanguageModelV4CallOptions[] = [];
    models.set(FLASH.model, streaming(answer("Hola."), seen));
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      candidates: [FLASH],
      effort: "max",
      ledger: newLedger(),
    });
    await read((await model.doStream(CALL)).stream);
    expect(asked).toEqual([{ id: FLASH.model, effort: "max" }]);
    // Gemini thinks at most at high: 2,000 x 4.
    expect(seen[0].maxOutputTokens).toBe(8_000);
    // 20,000 in at $0.75 and 8,000 out at $3.75 per 1M.
    expect(openDirectCall.mock.calls[0][1]).toMatchObject({
      estimateMax: 0.045,
    });
    vi.useRealTimers();
  });

  it("a step the provider refused moves down the route, said so", async () => {
    models.set(
      LUNA.model,
      new MockLanguageModelV4({
        doStream: async () => {
          throw Object.assign(new Error("OpenAI is down"), { status: 503 });
        },
      }),
    );
    models.set(FLASH.model, streaming(answer("Hola.")));
    const ledger = newLedger();
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger,
    });
    await read((await model.doStream(CALL)).stream);
    expect(opened.map((o) => o.model)).toEqual([LUNA.model, FLASH.model]);
    expect(opened[0].failed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503 }),
    );
    expect(openDirectCall.mock.calls[1][1]).toMatchObject({
      route: { switched: [{ from: LUNA, to: FLASH }] },
    });
    expect(ledger.models).toEqual(["Gemini 3.8 Flash · low"]);
    expect(ledger.moves).toEqual([
      expect.objectContaining({ from: "GPT-6 Luna", to: "Gemini 3.8 Flash" }),
    ]);
  });

  it("a route's last refusal reaches the turn in Kiln's words", async () => {
    models.set(
      ARGON.model,
      new MockLanguageModelV4({
        doStream: async () => {
          throw fromChat(ARGON_FREE_TIER);
        },
      }),
    );
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      candidates: [ARGON],
      effort: "high",
      ledger: newLedger(),
    });
    await expect(model.doStream(CALL)).rejects.toMatchObject({
      status: 429,
      message:
        "Gemini 4 Argon is not on Google's free tier, and this key's project is on it — link a billing account to the project in AI Studio, or pick another model.",
    });
    expect(opened[0].failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: ARGON_FREE_TIER.error.message }),
    );
  });

  it("a step with no answer is never sent to another model", async () => {
    models.set(
      LUNA.model,
      new MockLanguageModelV4({
        doStream: async () => {
          throw new Error("The operation timed out");
        },
      }),
    );
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger: newLedger(),
    });
    await expect(model.doStream(CALL)).rejects.toThrow("timed out");
    expect(opened).toHaveLength(1);
  });

  it("the cap refuses a step before any request", async () => {
    openDirectCall.mockRejectedValueOnce(
      Object.assign(new Error("This month's cap is reached."), {
        reason: "cap",
      }),
    );
    const doStream = vi.fn();
    models.set(LUNA.model, new MockLanguageModelV4({ doStream }));
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger: newLedger(),
    });
    await expect(model.doStream(CALL)).rejects.toThrow("cap is reached");
    expect(doStream).not.toHaveBeenCalled();
  });

  // A call refused when it is opened was never made: no row, no request.
  // It moves along the route the maker saved exactly as a refused request
  // does, and nothing is closed or marked failed for it.
  const noKey = (message: string) =>
    Object.assign(new Error(message), {
      name: "ProviderKeyMissing",
      provider: "openai",
    });
  const OWNERS_NO_KEY =
    "OpenAI has no API key: add one in Settings → Providers.";
  const MEMBERS_NO_KEY = "You have no access to an OpenAI key; ask Ana.";
  const UNLISTED =
    "OpenAI no longer offers GPT-6 Luna (its model list, checked 2026-10-31) — pick another model.";

  it("a step whose provider has no key in reach runs on the route's next model, said so", async () => {
    openDirectCall.mockRejectedValueOnce(noKey(MEMBERS_NO_KEY));
    const refused = vi.fn();
    models.set(LUNA.model, new MockLanguageModelV4({ doStream: refused }));
    models.set(FLASH.model, streaming(answer("Hola.")));
    const ledger = newLedger();
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger,
    });
    await read((await model.doStream(CALL)).stream);
    expect(refused).not.toHaveBeenCalled();
    expect(openDirectCall).toHaveBeenCalledTimes(2);
    expect(openDirectCall.mock.calls[0][1]).toMatchObject({
      model: LUNA.model,
    });
    expect(openDirectCall.mock.calls[1][1]).toMatchObject({
      model: FLASH.model,
      route: {
        switched: [{ from: LUNA, to: FLASH, reason: "OpenAI has no API key" }],
      },
    });
    // Only the call that was opened is settled.
    expect(opened.map((o) => o.model)).toEqual([FLASH.model]);
    expect(opened[0].failed).not.toHaveBeenCalled();
    expect(opened[0].done).toHaveBeenCalledTimes(1);
    expect(ledger.models).toEqual(["Gemini 3.8 Flash · low"]);
    expect(ledger.moves).toEqual([
      {
        from: "GPT-6 Luna",
        to: "Gemini 3.8 Flash",
        reason: "OpenAI has no API key",
      },
    ]);
  });

  it("a step on a model its provider no longer offers runs on the route's next model, said so", async () => {
    openDirectCall.mockRejectedValueOnce(
      Object.assign(new Error(UNLISTED), { name: "CapabilityError" }),
    );
    models.set(FLASH.model, streaming(answer("Hola.")));
    const ledger = newLedger();
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger,
    });
    await read((await model.doStream(CALL)).stream);
    expect(opened.map((o) => o.model)).toEqual([FLASH.model]);
    expect(opened[0].failed).not.toHaveBeenCalled();
    expect(openDirectCall.mock.calls[1][1]).toMatchObject({
      route: { switched: [{ from: LUNA, to: FLASH }] },
    });
    expect(ledger.moves).toEqual([
      {
        from: "GPT-6 Luna",
        to: "Gemini 3.8 Flash",
        reason: "OpenAI cannot run this request",
      },
    ]);
  });

  it("with no saved route a step refused at opening is refused as it is, in the reader's words", async () => {
    for (const refusal of [
      noKey(OWNERS_NO_KEY),
      noKey(MEMBERS_NO_KEY),
      Object.assign(new Error(UNLISTED), { name: "CapabilityError" }),
    ]) {
      openDirectCall.mockRejectedValueOnce(refusal);
      const doStream = vi.fn();
      models.set(LUNA.model, new MockLanguageModelV4({ doStream }));
      const ledger = newLedger();
      const model = routedChatModel({ id: "test" }, "chatTurn", {
        candidates: [LUNA],
        effort: "low",
        ledger,
      });
      await expect(model.doStream(CALL)).rejects.toBe(refusal);
      expect(doStream).not.toHaveBeenCalled();
      expect(opened).toHaveLength(0);
      expect(ledger.moves).toEqual([]);
      expect(openDirectCall).toHaveBeenCalledTimes(1);
      openDirectCall.mockClear();
    }
  });

  it("a provider with no key in reach is not tried again on its other models", async () => {
    const SOL = { provider: "openai" as const, model: "gpt-6.1-sol" };
    const refusal = noKey(OWNERS_NO_KEY);
    openDirectCall.mockRejectedValueOnce(refusal);
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      candidates: [LUNA, SOL],
      effort: "low",
      ledger: newLedger(),
    });
    await expect(model.doStream(CALL)).rejects.toBe(refusal);
    expect(openDirectCall).toHaveBeenCalledTimes(1);
  });

  it("the cap's refusal at opening is thrown as it is and never moves along the route", async () => {
    const over = Object.assign(new Error("Over this month's limit: ask Ana."), {
      reason: "cap",
    });
    openDirectCall.mockRejectedValueOnce(over);
    const doStream = vi.fn();
    models.set(LUNA.model, new MockLanguageModelV4({ doStream }));
    models.set(FLASH.model, new MockLanguageModelV4({ doStream }));
    const ledger = newLedger();
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger,
    });
    await expect(model.doStream(CALL)).rejects.toBe(over);
    expect(openDirectCall).toHaveBeenCalledTimes(1);
    expect(doStream).not.toHaveBeenCalled();
    expect(ledger.moves).toEqual([]);
  });

  it("a stream stopped midway closes its call as one that may be charged", async () => {
    models.set(
      LUNA.model,
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(c) {
              c.enqueue({ type: "text-start", id: "t" });
            },
          }),
        }),
      }),
    );
    const model = routedChatModel({ id: "test" }, "chatTurn", {
      ...ROUTE,
      ledger: newLedger(),
    });
    const { stream } = await model.doStream(CALL);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel(new Error("Stopped by the maker."));
    expect(opened[0].failed).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Stopped by the maker." }),
    );
    expect(opened[0].done).not.toHaveBeenCalled();
  });
});
