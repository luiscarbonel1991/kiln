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
// approves); "from above" tunes the Etsy hero's camera; "title" or "tags"
// reads the Etsy listing, then shortens its title or adds the brief's tag
// ideas (in the general mode it suggests the Etsy specialist instead);
// "designs" lists the designs; on a design, "vectoriz" reads it and traces
// its first drawn drawing, and "draw" or "dibuj" quotes its drawings, then
// asks to draw them (the general mode suggests the SVG specialist);
// "always" or "siempre" (a lasting preference) proposes it as a lesson,
// and "lessons" or "lecciones" reads the kept ones;
// anything else says how to try it. The project comes from the instructions
// ("Project id: <id>"). KILN_MOCK_FAIL naming the provider makes it answer
// as a provider that is down.

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

// A title cut to its first words, under 60 characters.
function shorter(title: string): string {
  const words = title.split(/\s+/);
  let out = "";
  for (const word of words) {
    if (`${out} ${word}`.trim().length > 60) break;
    out = `${out} ${word}`.trim();
  }
  return out || title.slice(0, 60);
}

function listingEdit(
  v: Record<string, unknown>,
  asked: string,
  project: string | undefined,
): MockReply {
  const where = { project, destination: "etsy" };
  if (/t[ií]tulo|title/.test(asked)) {
    const title = (v.title as { value?: string } | undefined)?.value ?? "";
    return { tool: "edit_listing", input: { ...where, title: shorter(title) } };
  }
  const tags = (v.tags as { value?: string[] } | undefined)?.value ?? [];
  const ideas = ((v.tagIdeas as { term: string }[] | undefined) ?? []).map(
    (i) => i.term,
  );
  if (ideas.length === 0) return { text: "The brief has no tag ideas left." };
  return {
    tool: "edit_listing",
    input: { ...where, tags: [...tags, ...ideas].slice(0, 13) },
  };
}

function summary(
  toolName: string,
  value: unknown,
  asked: string,
  project: string | undefined,
): MockReply {
  const v = (value ?? {}) as Record<string, unknown>;
  if (toolName === "get_listing") return listingEdit(v, asked, project);
  if (toolName === "edit_listing" && Array.isArray(v.written)) {
    const issues = Array.isArray(v.issues) ? v.issues.length : 0;
    return {
      text: `Edited the ${v.written.join(" and ")}: ${issues} issues left.`,
    };
  }
  if (toolName === "tune_frame" && typeof v.summary === "string") {
    return { text: `${v.frame} now: ${v.summary}. Nothing was generated.` };
  }
  if (toolName === "suggest_specialist") {
    const label = v.specialist === "svg" ? "SVG" : "Etsy";
    return {
      text: `The ${label} specialist does this best: switch with the button.`,
    };
  }
  if (toolName === "quote" && typeof v.quote === "string") {
    return {
      tool: v.action === "draw" ? "draw" : "generate",
      input: { quote: v.quote },
    };
  }
  if (toolName === "list_designs" && Array.isArray(v.designs)) {
    return {
      text: `${v.designs.length} designs: ${v.designs.map((d: { name?: string }) => d.name).join(", ") || "none yet"}.`,
    };
  }
  if (toolName === "get_design" && Array.isArray(v.drawings)) {
    const drawn = (v.drawings as { card: string; state: string }[]).find(
      (d) => d.state === "drawn" || d.state === "vectorized",
    );
    if (/vectori[sz]/.test(asked) && drawn) {
      return {
        tool: "vectorize",
        input: { project, card: drawn.card, mode: "outline", detail: "clean" },
      };
    }
    return { text: `${v.drawings.length} drawings. ${String(v.next ?? "")}` };
  }
  if (toolName === "vectorize" && typeof v.vector === "string") {
    return {
      text: `Traced ${v.label}: ${v.shapes} shapes, kept as its vector.`,
    };
  }
  if (toolName === "list_lessons" && Array.isArray(v.lessons)) {
    return { text: `${v.lessons.length} lessons kept.` };
  }
  if (toolName === "propose_lesson") {
    return { text: "I proposed it as a lesson: keep it to make it count." };
  }
  if (toolName === "draw" && typeof v.queued === "number") {
    return {
      text: `Queued ${v.queued} drawings. This chat notes when they land.`,
    };
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
  const project = /Project id: ([\w-]+)/.exec(
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
    const user = [...prompt].reverse().find((m) => m.role === "user");
    return summary(
      result.toolName,
      output.type === "json" ? output.value : undefined,
      user ? textOf(user.content).toLowerCase() : "",
      project,
    );
  }
  const asked = last?.role === "user" ? textOf(last.content).toLowerCase() : "";
  const general = /You are in Kiln's general mode/.test(
    system ? textOf(system.content) : "",
  );
  if (/\b(always|never|siempre|nunca)\b/.test(asked)) {
    const said = last?.role === "user" ? textOf(last.content).trim() : "";
    return {
      tool: "propose_lesson",
      input: { topic: "general", text: said.slice(0, 240) },
    };
  }
  if (/lecci[oó]n|lessons?\b/.test(asked)) {
    return { tool: "list_lessons", input: {} };
  }
  const wantsVector = /vectori[sz]|svg/.test(asked);
  const wantsDrawing = /dibuj|\bdraw\b|line art/.test(asked);
  if (/designs|dise[ñn]os/.test(asked) && !project) {
    return { tool: "list_designs", input: {} };
  }
  if ((wantsVector || wantsDrawing) && general) {
    return {
      tool: "suggest_specialist",
      input: { specialist: "svg", why: "It draws and traces designs." },
    };
  }
  if ((wantsVector || wantsDrawing) && !project) {
    return { text: "Open a design's chat to try that." };
  }
  if (wantsVector) return { tool: "get_design", input: { project } };
  if (wantsDrawing) {
    return { tool: "quote", input: { action: "draw", project } };
  }
  const wantsListing = /t[ií]tulo|title|tags|etiquetas/.test(asked);
  const wantsAbove = /desde arriba|from above/.test(asked);
  if ((wantsListing || wantsAbove) && !project) {
    return { text: "Open a project's chat to try that." };
  }
  if (wantsListing && general) {
    return {
      tool: "suggest_specialist",
      input: {
        specialist: "etsy",
        why: "It reads and edits the listing's text.",
      },
    };
  }
  if (wantsListing) {
    return { tool: "get_listing", input: { project, destination: "etsy" } };
  }
  if (wantsAbove) {
    return {
      tool: "tune_frame",
      input: { project, frame: "etsy.hero", knobs: { camera: "above" } },
    };
  }
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
