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
const offered: string[][] = [];
const generated: unknown[] = [];
const ran: { id: string; effort: unknown }[] = [];
// The maker's agents' routes, read instead of the stored ones.
const setup = vi.hoisted(() => ({ agents: {} as Record<string, unknown> }));

// Spend under the cap is the routed model's (routed-model.test.ts).
vi.mock("@/server/direct-spend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/direct-spend")>()),
  openDirectCall: async () => ({
    beforeCall: async () => {},
    done: async () => {},
    failed: async () => {},
  }),
}));
vi.mock("@/server/maker-repository", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/maker-repository")>();
  return {
    ...real,
    getMakerModelSetup: async (maker: { id: string }) => ({
      ...(await real.getMakerModelSetup(maker)),
      routes: null,
      agents: setup.agents,
    }),
  };
});
vi.mock("@/providers/registry", () => ({
  getChatModels: () => ({
    model: (id: string, effort: unknown) => {
      ran.push({ id, effort });
      return new MockLanguageModelV4({
        doStream: async ({ prompt, tools }) => {
          prompts.push(prompt);
          offered.push((tools ?? []).map((t) => t.name));
          const chunks = replies.shift();
          if (!chunks) throw new Error("The script ran out of replies.");
          return { stream: simulateReadableStream({ chunks }) };
        },
      });
    },
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
    const created = await repo.createChatSession(maker, projectId);
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
    const response = await runTurn(maker, { sessionId, message });
    const body = await response.text();
    for (
      let i = 0;
      i < 50 && (await repo.getChat(maker, sessionId))?.running;
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return body;
  }

  const lastReply = async (sessionId: string) =>
    (await repo.getChat(maker, sessionId))?.messages.at(-1) as KilnMessage;

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
    const chat = await repo.getChat(maker, id);
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
      effort: "low",
      models: ["GPT-6.1 Sol · low"],
    });
    const recorded = await db.toolCall.findMany({ where: { sessionId: id } });
    expect(recorded).toEqual([
      expect.objectContaining({ tool: "peek", tokenName: "Chat", ok: true }),
    ]);
  });

  // A turn's tool calls are recorded in the name of the person who
  // sent it (the session's maker carries its member down).
  it("records each tool call of a turn with the person who sent it", async () => {
    const { id } = await session();
    const person = {
      ...maker,
      member: { id: "m-chat", userId: "u-chat", role: "member" as const },
    };
    replies.push(call("c9", "peek", {}), say("I see 3."));
    const response = await runTurn(person, {
      sessionId: id,
      message: user("u1", "What do you see?"),
    });
    await response.text();
    for (let i = 0; i < 50 && (await repo.getChat(maker, id))?.running; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const recorded = await db.toolCall.findMany({ where: { sessionId: id } });
    expect(recorded.map((r) => [r.tool, r.memberId])).toEqual([
      ["peek", "m-chat"],
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
    await repo.lockChat(maker, id);
    await expect(
      runTurn(maker, { sessionId: id, message: user("u1", "hi") }),
    ).rejects.toThrow(TurnRefusal);
    await repo.unlockChat(maker, id);
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

  it("a specialist's turn offers only its tools, and says which it was", async () => {
    const { id } = await session();
    offered.length = 0;
    replies.push(say("Tuned."));
    const response = await runTurn(maker, {
      sessionId: id,
      message: user("u1", "lower the camera"),
      specialist: "scenes",
    });
    await response.text();
    for (let i = 0; i < 50 && (await repo.getChat(maker, id))?.running; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(offered[0]).toEqual(["generate"]);
    expect((await lastReply(id)).metadata).toMatchObject({
      specialist: "scenes",
    });
    replies.push(say("Hi."));
    await turn(id, user("u2", "hello"));
    expect(offered[1]).toEqual(["peek", "generate", "suggest_specialist"]);
  });

  it("an agent with its own model runs on it at its effort, planning too; the others on the fast route", async () => {
    setup.agents = {
      etsy: {
        models: [{ provider: "openai", model: "gpt-6-astra" }],
        fallback: false,
        effort: "max",
      },
    };
    const { id } = await session();
    ran.length = 0;
    replies.push(say("Shorter."), say("Planned."), say("Hi."));
    for (const [n, plan, specialist] of [
      [1, false, "etsy"],
      [2, true, "etsy"],
      [3, false, "kiln"],
    ] as const) {
      const response = await runTurn(maker, {
        sessionId: id,
        message: user(`u${n}`, "the title"),
        specialist,
        plan,
      });
      await response.text();
      for (let i = 0; i < 50 && (await repo.getChat(maker, id))?.running; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    expect(ran).toEqual([
      { id: "gpt-6-astra", effort: "max" },
      { id: "gpt-6-astra", effort: "max" },
      { id: "gpt-6.1-sol", effort: "low" },
    ]);
    const replies_ = (await repo.getChat(maker, id))?.messages.filter(
      (m) => m.role === "assistant",
    ) as KilnMessage[];
    expect(replies_.map((m) => m.metadata)).toMatchObject([
      { role: "fast", effort: "max", models: ["GPT-6 Astra · max"] },
      { role: "deep", effort: "max", models: ["GPT-6 Astra · max"] },
      { role: "fast", effort: "low", models: ["GPT-6.1 Sol · low"] },
    ]);
    setup.agents = {};
  });
});
