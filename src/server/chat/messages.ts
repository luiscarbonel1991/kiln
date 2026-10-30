import type { UIMessage } from "ai";
import { z } from "zod";

// A chat's messages as the chat shows them (the AI SDK's UIMessage), and the
// two rules that keep the conversation Kiln's: the browser sends only what
// the maker did (a new message, or a yes or no to a tool call that waits for
// one), and a notice from Kiln (a batch that finished) reaches the model as
// context with the maker's next message.

export const ChatRole = z.enum(["fast", "deep"]);
export type ChatRole = z.infer<typeof ChatRole>;

// What a turn records on its reply: the role it ran on, the models that
// answered (after a move down the route, the first it left and why), what it
// cost, and why it ended early.
export const ChatMetadata = z.object({
  role: ChatRole.optional(),
  models: z.array(z.string()).optional(),
  moves: z
    .array(z.object({ from: z.string(), to: z.string(), reason: z.string() }))
    .optional(),
  costMicros: z.number().int().nonnegative().optional(),
  stopped: z.string().optional(),
});
export type ChatMetadata = z.infer<typeof ChatMetadata>;

export type KilnEvent = { text: string };

export type KilnMessage = UIMessage<ChatMetadata, { "kiln-event": KilnEvent }>;

export const EVENT_PREFIX = "event-";

export function isEvent(message: { id: string }): boolean {
  return message.id.startsWith(EVENT_PREFIX);
}

export function eventText(message: KilnMessage): string {
  return message.parts
    .map((p) => (p.type === "data-kiln-event" ? p.data.text : ""))
    .filter(Boolean)
    .join(" ");
}

export const MAX_MESSAGE_CHARS = 8_000;

const Incoming = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.string(), z.unknown())).max(200),
});

type Merged = { messages: KilnMessage[] } | { error: string };

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  approval?: { id: string; approved?: boolean; isAutomatic?: boolean };
};

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

// The stored conversation with what the browser sent: a new message of the
// maker's (its text only), or the maker's yes or no to the tool calls of the
// last reply that wait for one (only that answer is taken; the call, its
// input and the rest stay as stored).
export function mergeIncoming(stored: KilnMessage[], raw: unknown): Merged {
  const parsed = Incoming.safeParse(raw);
  if (!parsed.success) return { error: "That message cannot be read." };
  const incoming = parsed.data;
  if (incoming.role === "user") {
    if (stored.some((m) => m.id === incoming.id)) {
      return { error: "That message was sent already." };
    }
    const text = incoming.parts
      .map((p) =>
        p.type === "text" && typeof p.text === "string" ? p.text : "",
      )
      .join("\n")
      .trim();
    if (!text) return { error: "Write a message first." };
    if (text.length > MAX_MESSAGE_CHARS) {
      return { error: `Keep a message under ${MAX_MESSAGE_CHARS} characters.` };
    }
    return {
      messages: [
        ...stored,
        { id: incoming.id, role: "user", parts: [{ type: "text", text }] },
      ],
    };
  }
  const at = stored.findLastIndex((m) => !isEvent(m));
  const last = stored[at];
  if (!last || last.id !== incoming.id || last.role !== "assistant") {
    return { error: "Only the last reply's tool calls can be answered." };
  }
  const answers = new Map<string, boolean>();
  for (const part of incoming.parts as unknown as ToolPart[]) {
    if (
      typeof part.type === "string" &&
      isToolPart(part) &&
      part.state === "approval-responded" &&
      typeof part.approval?.id === "string" &&
      typeof part.approval.approved === "boolean"
    ) {
      answers.set(part.approval.id, part.approval.approved);
    }
  }
  let answered = 0;
  const parts = last.parts.map((part) => {
    if (!isToolPart(part)) return part;
    const tool = part as unknown as ToolPart;
    if (
      tool.state !== "approval-requested" ||
      !tool.approval ||
      tool.approval.isAutomatic ||
      !answers.has(tool.approval.id)
    ) {
      return part;
    }
    answered += 1;
    return {
      ...part,
      state: "approval-responded",
      approval: { ...tool.approval, approved: answers.get(tool.approval.id) },
    } as typeof part;
  });
  if (answered === 0) return { error: "Nothing there waits for an answer." };
  const messages = [...stored];
  messages[at] = { ...last, parts };
  return { messages };
}

// The conversation as the model reads it: Kiln's notices folded into the
// maker's next message (a provider may refuse two replies in a row), and the
// notices after the maker's last message left for the next turn.
export function forModel(messages: KilnMessage[]): KilnMessage[] {
  const out: KilnMessage[] = [];
  let notices: string[] = [];
  for (const message of messages) {
    if (isEvent(message)) {
      const text = eventText(message);
      if (text) notices.push(text);
      continue;
    }
    if (message.role === "user" && notices.length > 0) {
      out.push({
        ...message,
        parts: [
          {
            type: "text",
            text: `(Kiln, since the last turn: ${notices.join(" ")})`,
          },
          ...message.parts,
        ],
      });
      notices = [];
      continue;
    }
    out.push(message);
  }
  return out;
}

// A message as it is stored: a take a tool showed the model (view_frame) is
// kept by its address only, so a later turn reads that it was shown, not
// the image again.
export function withoutImageData(message: KilnMessage): KilnMessage {
  let changed = false;
  const parts = message.parts.map((part) => {
    if (!isToolPart(part)) return part;
    const tool = part as unknown as {
      state?: string;
      output?: { images?: { data?: string; mimeType: string }[] };
    };
    const images = tool.output?.images;
    if (tool.state !== "output-available" || !images?.some((i) => i.data)) {
      return part;
    }
    changed = true;
    return {
      ...part,
      output: {
        ...tool.output,
        images: images.map(({ mimeType }) => ({ mimeType })),
      },
    } as typeof part;
  });
  return changed ? { ...message, parts } : message;
}
