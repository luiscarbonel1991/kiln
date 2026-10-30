import type {
  LanguageModelV4,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type { ProviderId } from "@/domain/model-defaults";
import type { ChatModels } from "@/providers/interfaces";
import { mockDelay, mockOutage } from "@/providers/mode";

// The chat in a mock run: no model, a few rules, so the chat can be tried for
// free. "frames" or "estado" reads the frames; "genera" or "generate" quotes
// the waiting scenes, then asks to generate them on that quote (the maker
// approves); anything else says how to try it. The project comes from the
// instructions ("Project id: <id>"). KILN_MOCK_FAIL naming the provider makes
// it answer as a provider that is down.

export type MockReply =
  | { text: string }
  | { tool: string; input: Record<string, unknown> };

const HELP =
  'A mock chat: nothing here is paid. Ask "how are the frames?" to read them, or "generate the scenes" to quote them and approve.';

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p: { type?: string; text?: string }) =>
      p.type === "text" ? (p.text ?? "") : "",
    )
    .join(" ");
}

function summary(toolName: string, value: unknown): MockReply {
  const v = (value ?? {}) as Record<string, unknown>;
  if (toolName === "quote" && typeof v.quote === "string") {
    return { tool: "generate", input: { quote: v.quote } };
  }
  if (toolName === "get_frames" && Array.isArray(v.frames)) {
    const counts = new Map<string, number>();
    for (const f of v.frames as { state?: string }[]) {
      const state = f.state ?? "unknown";
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    const parts = [...counts].map(([state, n]) => `${n} ${state}`);
    return {
      text: `${v.frames.length} frames: ${parts.join(", ") || "none yet"}.`,
    };
  }
  if (toolName === "generate" && typeof v.queued === "number") {
    return {
      text: `Queued ${v.queued} scenes. This chat notes when they land.`,
    };
  }
  return { text: "Done." };
}

export function mockReply(prompt: LanguageModelV4Prompt): MockReply {
  const system = prompt.find((m) => m.role === "system");
  const project = /Project id: (\S+)/.exec(
    system ? textOf(system.content) : "",
  )?.[1];
  const last = prompt.at(-1);
  if (last?.role === "tool") {
    const result = [...last.content]
      .reverse()
      .find((p) => p.type === "tool-result");
    if (!result || result.type !== "tool-result") return { text: "Done." };
    const output = result.output;
    if (output.type === "execution-denied") {
      return { text: "Okay, nothing was spent." };
    }
    if (output.type === "error-text" || output.type === "error-json") {
      return { text: `That was refused: ${JSON.stringify(output.value)}` };
    }
    return summary(
      result.toolName,
      output.type === "json" ? output.value : undefined,
    );
  }
  const asked = last?.role === "user" ? textOf(last.content).toLowerCase() : "";
  const wantsFrames = /frame|estado|status|c[oó]mo van|how are/.test(asked);
  const wantsScenes = /gener[aá]|generate/.test(asked);
  if ((wantsFrames || wantsScenes) && !project) {
    return { text: "Open a project's chat to try that." };
  }
  if (wantsScenes) {
    return { tool: "quote", input: { action: "generate", project } };
  }
  if (wantsFrames) return { tool: "get_frames", input: { project } };
  return { text: HELP };
}

const NO_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

let calls = 0;

function content(reply: MockReply): {
  content: LanguageModelV4Content[];
  finishReason: LanguageModelV4FinishReason;
} {
  if ("text" in reply) {
    return {
      content: [{ type: "text", text: reply.text }],
      finishReason: { unified: "stop", raw: undefined },
    };
  }
  calls += 1;
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `mock-call-${Date.now()}-${calls}`,
        toolName: reply.tool,
        input: JSON.stringify(reply.input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
  };
}

function streamOf(reply: MockReply): ReadableStream<LanguageModelV4StreamPart> {
  const { content: parts, finishReason } = content(reply);
  const chunks: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
  ];
  for (const part of parts) {
    if (part.type === "text") {
      chunks.push({ type: "text-start", id: "mock-text" });
      for (const word of part.text.match(/\S+\s*/g) ?? []) {
        chunks.push({ type: "text-delta", id: "mock-text", delta: word });
      }
      chunks.push({ type: "text-end", id: "mock-text" });
    } else {
      chunks.push(part as LanguageModelV4StreamPart);
    }
  }
  chunks.push({ type: "finish", usage: NO_USAGE, finishReason });
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

export function mockChatModels(provider: ProviderId): ChatModels {
  return {
    model(id): LanguageModelV4 {
      return {
        specificationVersion: "v4",
        provider,
        modelId: id,
        supportedUrls: {},
        async doGenerate(options) {
          mockOutage(provider);
          await mockDelay();
          return {
            ...content(mockReply(options.prompt)),
            usage: NO_USAGE,
            warnings: [],
          };
        },
        async doStream(options) {
          mockOutage(provider);
          await mockDelay();
          return { stream: streamOf(mockReply(options.prompt)) };
        },
      };
    },
  };
}
