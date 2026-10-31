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
const openDirectCall = vi.fn(async (priced: { model: string }) => {
  const call = {
    model: priced.model,
    beforeCall: vi.fn(async () => {}),
    done: vi.fn(async () => {}),
    failed: vi.fn(async () => {}),
  };
  opened.push(call);
  return call;
});
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
    const model = routedChatModel("chatTurn", {
      ...ROUTE,
      projectId: "p1",
      ledger,
    });
    const { stream } = await model.doStream(CALL);
    await read(stream);
    expect(openDirectCall).toHaveBeenCalledWith(
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
    const model = routedChatModel("chatTurn", {
      candidates: [FLASH],
      effort: "max",
      ledger: newLedger(),
    });
    await read((await model.doStream(CALL)).stream);
    expect(asked).toEqual([{ id: FLASH.model, effort: "max" }]);
    // Gemini thinks at most at high: 2,000 x 4.
    expect(seen[0].maxOutputTokens).toBe(8_000);
    // 20,000 in at $0.75 and 8,000 out at $3.75 per 1M.
    expect(openDirectCall.mock.calls[0][0]).toMatchObject({
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
    const model = routedChatModel("chatTurn", { ...ROUTE, ledger });
    await read((await model.doStream(CALL)).stream);
    expect(opened.map((o) => o.model)).toEqual([LUNA.model, FLASH.model]);
    expect(opened[0].failed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503 }),
    );
    expect(openDirectCall.mock.calls[1][0]).toMatchObject({
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
    const model = routedChatModel("chatTurn", {
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
    const model = routedChatModel("chatTurn", {
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
    const model = routedChatModel("chatTurn", {
      ...ROUTE,
      ledger: newLedger(),
    });
    await expect(model.doStream(CALL)).rejects.toThrow("cap is reached");
    expect(doStream).not.toHaveBeenCalled();
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
    const model = routedChatModel("chatTurn", {
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
