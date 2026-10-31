import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolResultOutput,
} from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hadResponse } from "@/domain/queue";
import { answeredError, chatModel } from "@/providers/chat-model";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@ai-sdk/openai");
  vi.doUnmock("@ai-sdk/google");
});

const CALL: LanguageModelV4CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

async function partsOf(
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<LanguageModelV4StreamPart[]> {
  const parts: LanguageModelV4StreamPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}

function fakeModel(
  over: Partial<LanguageModelV4> = {},
  seen: LanguageModelV4CallOptions[] = [],
): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "openai.responses",
    modelId: "gpt-6-luna",
    supportedUrls: {},
    async doGenerate(options) {
      seen.push(options);
      throw new Error("not used");
    },
    async doStream(options) {
      seen.push(options);
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "error", error: { statusCode: 503 } });
            c.close();
          },
        }),
      };
    },
    ...over,
  };
}

describe("answeredError", () => {
  it("reads an HTTP error as Kiln does: its status and the provider's own words", () => {
    const read = answeredError({
      statusCode: 429,
      message: "Too Many Requests",
      responseBody: JSON.stringify({
        error: { message: "You exceeded your current quota" },
      }),
    }) as Error & { status: number };
    expect(read.status).toBe(429);
    expect(read.message).toBe("You exceeded your current quota");
    expect(hadResponse(read)).toBe(true);
  });

  it("leaves an error with no answer (a timeout, an abort) as it was", () => {
    const timeout = new Error("The operation timed out");
    expect(answeredError(timeout)).toBe(timeout);
    expect(hadResponse(answeredError(timeout))).toBe(false);
  });
});

describe("chatModel", () => {
  it("puts Kiln's defaults under the caller's options", async () => {
    const seen: LanguageModelV4CallOptions[] = [];
    const model = chatModel(fakeModel({}, seen), {
      openai: { reasoningEffort: "low", store: false },
    });
    await model.doStream({
      ...CALL,
      providerOptions: { openai: { reasoningEffort: "high" } },
    });
    expect(seen[0].providerOptions).toEqual({
      openai: { reasoningEffort: "high", store: false },
    });
  });

  it("reads an error thrown by the request and one inside the stream", async () => {
    const refused = chatModel(
      fakeModel({
        async doStream() {
          throw { statusCode: 400, message: "Bad Request" };
        },
      }),
      {},
    );
    await expect(refused.doStream(CALL)).rejects.toMatchObject({
      status: 400,
    });
    const midway = chatModel(fakeModel(), {});
    const parts = await partsOf((await midway.doStream(CALL)).stream);
    expect(parts[0]).toMatchObject({ type: "error", error: { status: 503 } });
  });
});

describe("the providers' chat models", () => {
  it("OpenAI: the Responses API with its key, low reasoning and nothing stored", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const made: unknown[] = [];
    const seen: LanguageModelV4CallOptions[] = [];
    vi.doMock("@ai-sdk/openai", () => ({
      createOpenAI: (options: unknown) => {
        made.push(options);
        return { responses: (id: string) => fakeModel({ modelId: id }, seen) };
      },
    }));
    const { openaiChatModels } = await import("@/providers/openai/chat-model");
    const model = openaiChatModels.model("gpt-6-luna");
    await model.doStream(CALL);
    expect(made).toEqual([{ apiKey: "sk-test" }]);
    expect(model.modelId).toBe("gpt-6-luna");
    expect(seen[0].providerOptions?.openai).toMatchObject({
      reasoningEffort: "low",
      store: false,
    });
    expect(() => openaiChatModels.model("gpt-image-2")).toThrow();
  });

  it("refuses a model with no key before any request", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_API_KEY", undefined);
    const { openaiChatModels } = await import("@/providers/openai/chat-model");
    const { googleChatModels } = await import("@/providers/google/chat-model");
    expect(() => openaiChatModels.model("gpt-6-luna")).toThrow(
      /OpenAI has no API key/,
    );
    expect(() => googleChatModels.model("gemini-3.8-flash")).toThrow(
      /Google has no API key/,
    );
  });

  it("Google: its key and low thinking", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    const made: unknown[] = [];
    const seen: LanguageModelV4CallOptions[] = [];
    vi.doMock("@ai-sdk/google", () => ({
      createGoogleGenerativeAI: (options: unknown) => {
        made.push(options);
        return {
          languageModel: (id: string) => fakeModel({ modelId: id }, seen),
        };
      },
    }));
    const { googleChatModels } = await import("@/providers/google/chat-model");
    await googleChatModels.model("gemini-3.8-flash").doStream(CALL);
    expect(made).toEqual([{ apiKey: "g-test" }]);
    expect(seen[0].providerOptions?.google).toEqual({
      thinkingConfig: { thinkingLevel: "low" },
    });
  });
});

describe("the mock chat", () => {
  const system = { role: "system" as const, content: "Project id: p1" };
  const user = (text: string) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text }],
  });

  it("reads the frames, quotes the scenes, and says how to try it", async () => {
    const { mockReply } = await import("@/providers/mock/chat-model");
    expect(mockReply([system, user("¿Cómo van los frames?")])).toEqual({
      tool: "get_frames",
      input: { project: "p1" },
    });
    expect(mockReply([system, user("Generá las escenas")])).toEqual({
      tool: "quote",
      input: { action: "generate", project: "p1" },
    });
    expect(mockReply([user("generate")])).toEqual({
      text: "Open a project's chat to try that.",
    });
    expect(mockReply([system, user("hola")])).toMatchObject({
      text: expect.stringContaining("nothing here is paid"),
    });
  });

  it("asks to generate on the quote it got, and stops when the maker says no", async () => {
    const { mockReply } = await import("@/providers/mock/chat-model");
    const after = (
      toolName: string,
      output: LanguageModelV4ToolResultOutput,
    ): LanguageModelV4Prompt => [
      system,
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName, output }],
      },
    ];
    expect(
      mockReply(after("quote", { type: "json", value: { quote: "q1" } })),
    ).toEqual({ tool: "generate", input: { quote: "q1" } });
    expect(mockReply(after("generate", { type: "execution-denied" }))).toEqual({
      text: "Okay, nothing was spent.",
    });
    expect(
      mockReply(
        after("get_frames", {
          type: "json",
          value: { frames: [{ state: "approved" }, { state: "draft" }] },
        }),
      ),
    ).toEqual({ text: "2 frames: 1 approved, 1 draft." });
  });

  it("plays the specialists: the general mode suggests Etsy; Etsy reads, then edits the listing; Scenes tunes", async () => {
    const { mockReply } = await import("@/providers/mock/chat-model");
    const general = {
      role: "system" as const,
      content: "Project id: p1\nYou are in Kiln's general mode.",
    };
    expect(mockReply([general, user("Mejorá el título")])).toMatchObject({
      tool: "suggest_specialist",
      input: { specialist: "etsy" },
    });
    expect(mockReply([system, user("Acortá el título")])).toEqual({
      tool: "get_listing",
      input: { project: "p1", destination: "etsy" },
    });
    const read: LanguageModelV4Prompt = [
      system,
      user("Acortá el título"),
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "get_listing",
            output: {
              type: "json",
              value: {
                title: {
                  value:
                    "Walnut cutting board engraved with your family name, a wedding gift for the kitchen",
                },
              },
            },
          },
        ],
      },
    ];
    expect(mockReply(read)).toEqual({
      tool: "edit_listing",
      input: {
        project: "p1",
        destination: "etsy",
        title: "Walnut cutting board engraved with your family name, a",
      },
    });
    expect(mockReply([system, user("El hero desde arriba")])).toEqual({
      tool: "tune_frame",
      input: { project: "p1", frame: "etsy.hero", knobs: { camera: "above" } },
    });
  });

  it("plays the SVG specialist: lists designs, traces the first drawn drawing, quotes the drawings", async () => {
    const { mockReply } = await import("@/providers/mock/chat-model");
    expect(mockReply([user("Which designs do I have?")])).toEqual({
      tool: "list_designs",
      input: {},
    });
    const general = {
      role: "system" as const,
      content: "Project id: d1\nYou are in Kiln's general mode.",
    };
    expect(mockReply([general, user("Vectorizá el dibujo")])).toMatchObject({
      tool: "suggest_specialist",
      input: { specialist: "svg" },
    });
    expect(mockReply([system, user("Vectorizá el dibujo")])).toEqual({
      tool: "get_design",
      input: { project: "p1" },
    });
    const read: LanguageModelV4Prompt = [
      system,
      user("Vectorizá el dibujo"),
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "get_design",
            output: {
              type: "json",
              value: {
                drawings: [
                  { card: "recipe-line-art-0", state: "to-draw" },
                  { card: "recipe-line-art-1", state: "drawn" },
                ],
              },
            },
          },
        ],
      },
    ];
    expect(mockReply(read)).toEqual({
      tool: "vectorize",
      input: {
        project: "p1",
        card: "recipe-line-art-1",
        mode: "outline",
        detail: "clean",
      },
    });
    expect(mockReply([system, user("Draw the line art")])).toEqual({
      tool: "quote",
      input: { action: "draw", project: "p1" },
    });
    const quoted: LanguageModelV4Prompt = [
      system,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "quote",
            output: { type: "json", value: { quote: "q1", action: "draw" } },
          },
        ],
      },
    ];
    expect(mockReply(quoted)).toEqual({ tool: "draw", input: { quote: "q1" } });
  });

  it("proposes a lasting preference as a lesson, and reads the kept ones", async () => {
    const { mockReply } = await import("@/providers/mock/chat-model");
    expect(mockReply([user("¿Qué lecciones me guardaste?")])).toEqual({
      tool: "list_lessons",
      input: {},
    });
    expect(
      mockReply([system, user("Siempre fondo claro para los heroes")]),
    ).toEqual({
      tool: "propose_lesson",
      input: { topic: "general", text: "Siempre fondo claro para los heroes" },
    });
  });

  it("streams its answer, and answers as a provider that is down on KILN_MOCK_FAIL", async () => {
    vi.stubEnv("KILN_PROVIDERS", "mock");
    const { getChatModels } = await import("@/providers/registry");
    const model = getChatModels("openai").model("gpt-6-luna");
    const parts = await partsOf(
      (await model.doStream({ prompt: [system, user("hola")] })).stream,
    );
    expect(parts.map((p) => p.type)).toContain("text-delta");
    expect(parts.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop" },
    });
    vi.stubEnv("KILN_MOCK_FAIL", "openai");
    vi.resetModules();
    const { getChatModels: again } = await import("@/providers/registry");
    await expect(
      again("openai")
        .model("gpt-6-luna")
        .doStream({ prompt: [user("hola")] }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
