import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { KilnMessage } from "@/server/chat/messages";

// Turns against the throwaway Postgres (see project-repository.db.test.ts),
// with a scripted model and two stand-in tools: one free, one that waits for
// the maker's click (it has a paid tool's name). Kiln's own tools have their
// own tests.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

const replies: LanguageModelV4StreamPart[][] = [];
const prompts: unknown[] = [];
const generated: unknown[] = [];

// Spend under the cap is the routed model's (routed-model.test.ts).
vi.mock("@/server/direct-spend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/direct-spend")>()),
  openDirectCall: async () => ({
    beforeCall: async () => {},
    done: async () => {},
    failed: async () => {},
  }),
}));
vi.mock("@/providers/registry", () => ({
  getChatModels: () => ({
    model: () =>
      new MockLanguageModelV4({
        doStream: async ({ prompt }) => {
          prompts.push(prompt);
          const chunks = replies.shift();
          if (!chunks) throw new Error("The script ran out of replies.");
          return { stream: simulateReadableStream({ chunks }) };
        },
      }),
  }),
}));
vi.mock("@/server/tools", async () => {
  const { defineTool } = await import("@/server/tools/registry");
  return {
    TOOLS: [
      defineTool({
        name: "peek",
        title: "Peek",
        description: "Answers what it sees.",
        input: z.object({}),
        hints: { readOnly: true },
        run: async () => ({ data: { seen: 3 } }),
      }),
      defineTool({
        name: "generate",
        title: "Generate",
        description: "Spends on a quote.",
        input: z.object({ quote: z.string() }),
        hints: {},
        run: async (input) => {
          generated.push(input);
          return { data: { queued: 5 } };
        },
      }),
    ],
  };
});

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const say = (text: string): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  {
    type: "finish",
    finishReason: { unified: "stop", raw: undefined },
    usage: USAGE,
  },
];
const call = (
  id: string,
  toolName: string,
  input: Record<string, unknown>,
): LanguageModelV4StreamPart[] => [
  { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
  {
    type: "finish",
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: USAGE,
  },
];

describe.skipIf(!enabled)("a chat turn (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/chat/chat-repository");
  const { runTurn, TurnRefusal } = await import("@/server/chat/run-turn");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  let maker: { id: string };
  const made: string[] = [];
  const session = async (projectId?: string) => {
    const created = await repo.createChatSession(projectId);
    made.push(created.id);
    return created;
  };

  const user = (id: string, text: string) => ({
    id,
    role: "user",
    parts: [{ type: "text", text }],
  });

  // Run a turn to its end: the whole stream read, the session let go.
  async function turn(sessionId: string, message: unknown) {
    const response = await runTurn({ sessionId, message });
    const body = await response.text();
    for (let i = 0; i < 50 && (await repo.getChat(sessionId))?.running; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return body;
  }

  const lastReply = async (sessionId: string) =>
    (await repo.getChat(sessionId))?.messages.at(-1) as KilnMessage;

  const toolPart = (message: KilnMessage, name: string) =>
    message.parts.find((p) => p.type === `tool-${name}`) as
      | {
          toolCallId: string;
          state: string;
          input: unknown;
          output?: unknown;
          approval?: { id: string };
        }
      | undefined;

  beforeAll(async () => {
    maker = await getCurrentMaker();
  });

  afterAll(async () => {
    await db.chatSession.deleteMany({ where: { id: { in: made } } });
    await db.toolCall.deleteMany({ where: { sessionId: { in: made } } });
  });

  it("runs a free tool, answers, and stores the turn with what it ran on", async () => {
    const { id } = await session();
    replies.push(call("c1", "peek", {}), say("I see 3."));
    await turn(id, user("u1", "What do you see?"));
    const chat = await repo.getChat(id);
    expect(chat?.running).toBe(false);
    expect(chat?.title).toBe("What do you see?");
    const reply = chat?.messages.at(-1) as KilnMessage;
    expect(toolPart(reply, "peek")).toMatchObject({
      state: "output-available",
      output: { seen: 3 },
    });
    expect(
      reply.parts.some((p) => p.type === "text" && p.text === "I see 3."),
    ).toBe(true);
    expect(reply.metadata).toMatchObject({
      role: "fast",
      models: ["GPT-6.1 Sol"],
    });
    const recorded = await db.toolCall.findMany({ where: { sessionId: id } });
    expect(recorded).toEqual([
      expect.objectContaining({ tool: "peek", tokenName: "Chat", ok: true }),
    ]);
  });

  it("a paid tool waits for the maker's click, then runs the stored call once", async () => {
    const { id } = await session();
    replies.push(call("c2", "generate", { quote: "q1" }));
    await turn(id, user("u1", "Generate the scenes"));
    const waiting = await lastReply(id);
    const part = toolPart(waiting, "generate");
    expect(part?.state).toBe("approval-requested");
    expect(generated).toEqual([]);

    replies.push(say("Queued 5 scenes."));
    await turn(id, {
      id: waiting.id,
      role: "assistant",
      parts: [
        {
          type: "tool-generate",
          toolCallId: part?.toolCallId,
          state: "approval-responded",
          input: { quote: "someone-elses" },
          approval: { id: part?.approval?.id, approved: true },
        },
      ],
    });
    expect(generated).toEqual([{ quote: "q1" }]);
    const done = await lastReply(id);
    expect(done.id).toBe(waiting.id);
    expect(toolPart(done, "generate")).toMatchObject({
      state: "output-available",
      output: { queued: 5 },
    });
  });

  it("a click on no runs nothing, and the model hears it", async () => {
    generated.length = 0;
    const { id } = await session();
    replies.push(call("c3", "generate", { quote: "q2" }));
    await turn(id, user("u1", "Generate"));
    const waiting = await lastReply(id);
    const part = toolPart(waiting, "generate");
    replies.push(say("Okay, nothing was spent."));
    await turn(id, {
      id: waiting.id,
      role: "assistant",
      parts: [
        {
          type: "tool-generate",
          toolCallId: part?.toolCallId,
          state: "approval-responded",
          approval: { id: part?.approval?.id, approved: false },
        },
      ],
    });
    expect(generated).toEqual([]);
    expect(toolPart(await lastReply(id), "generate")?.state).toBe(
      "output-denied",
    );
  });

  it("refuses a turn while another holds the session", async () => {
    const { id } = await session();
    await repo.lockChat(id);
    await expect(
      runTurn({ sessionId: id, message: user("u1", "hi") }),
    ).rejects.toThrow(TurnRefusal);
    await repo.unlockChat(id);
  });

  it("a notice from Kiln reaches the model with the maker's next message", async () => {
    const project = await db.project.create({
      data: {
        makerId: maker.id,
        name: "Notice test",
        type: "listing-kit",
        phase: "generation",
      },
    });
    const { id } = await session(project.id);
    replies.push(say("Hi."));
    await turn(id, user("u1", "hi"));
    await repo.appendChatEvent(
      { projectId: project.id },
      "b9",
      "5 scenes landed.",
    );
    prompts.length = 0;
    replies.push(say("Good news."));
    await turn(id, user("u2", "any news?"));
    expect(JSON.stringify(prompts[0])).toContain(
      "(Kiln, since the last turn: 5 scenes landed.)",
    );
    await db.chatSession.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
  });
});
