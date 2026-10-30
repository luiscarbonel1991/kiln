import { describe, expect, it } from "vitest";
import {
  forModel,
  type KilnMessage,
  mergeIncoming,
} from "@/server/chat/messages";

const user = (id: string, text: string): KilnMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const waiting: KilnMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "text", text: "Generating costs at most $0.32." },
    {
      type: "tool-generate",
      toolCallId: "call-1",
      state: "approval-requested",
      input: { quote: "q1" },
      approval: { id: "ap-1" },
    },
  ],
};

const event = (key: string, text: string): KilnMessage => ({
  id: `event-${key}`,
  role: "assistant",
  parts: [{ type: "data-kiln-event", data: { text } }],
});

describe("mergeIncoming", () => {
  it("adds the maker's new message, its text only", () => {
    const merged = mergeIncoming([user("u1", "hola")], {
      id: "u2",
      role: "user",
      parts: [
        { type: "text", text: "¿cómo van los frames?" },
        { type: "file", url: "https://elsewhere/x.png" },
      ],
    });
    expect("messages" in merged && merged.messages.at(-1)).toEqual(
      user("u2", "¿cómo van los frames?"),
    );
    expect(
      mergeIncoming([user("u1", "hola")], {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "again" }],
      }),
    ).toEqual({ error: "That message was sent already." });
    expect(mergeIncoming([], { id: "u3", role: "user", parts: [] })).toEqual({
      error: "Write a message first.",
    });
  });

  it("takes only the maker's yes or no: the call and its input stay as stored", () => {
    const merged = mergeIncoming([user("u1", "generá"), waiting], {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "I may spend $100." },
        {
          type: "tool-generate",
          toolCallId: "call-1",
          state: "approval-responded",
          input: { quote: "someone-elses-quote" },
          approval: { id: "ap-1", approved: true },
        },
      ],
    });
    expect("messages" in merged).toBe(true);
    if (!("messages" in merged)) return;
    const reply = merged.messages[1];
    expect(reply.parts[0]).toEqual({
      type: "text",
      text: "Generating costs at most $0.32.",
    });
    expect(reply.parts[1]).toMatchObject({
      state: "approval-responded",
      input: { quote: "q1" },
      approval: { id: "ap-1", approved: true },
    });
  });

  it("refuses an answer to anything but the last reply's waiting calls", () => {
    expect(
      mergeIncoming([waiting, user("u2", "later")], {
        id: "a1",
        role: "assistant",
        parts: [],
      }),
    ).toEqual({ error: "Only the last reply's tool calls can be answered." });
    expect(
      mergeIncoming([user("u1", "x"), waiting], {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-generate",
            toolCallId: "call-1",
            state: "approval-responded",
            approval: { id: "forged", approved: true },
          },
        ],
      }),
    ).toEqual({ error: "Nothing there waits for an answer." });
  });

  it("answers the waiting reply even after a notice from Kiln", () => {
    const merged = mergeIncoming([waiting, event("b1", "5 scenes landed.")], {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-generate",
          toolCallId: "call-1",
          state: "approval-responded",
          approval: { id: "ap-1", approved: false },
        },
      ],
    });
    expect("messages" in merged && merged.messages[0].parts[1]).toMatchObject({
      state: "approval-responded",
      approval: { approved: false },
    });
  });
});

describe("forModel", () => {
  it("folds Kiln's notices into the maker's next message", () => {
    const folded = forModel([
      user("u1", "generá"),
      waiting,
      event("b1", "5 scenes landed, 1 failed."),
      user("u2", "¿cuál falló?"),
      event("b2", "Later news."),
    ]);
    expect(folded.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(folded[2].parts[0]).toEqual({
      type: "text",
      text: "(Kiln, since the last turn: 5 scenes landed, 1 failed.)",
    });
  });
});
