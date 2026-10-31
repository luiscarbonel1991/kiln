import { describe, expect, it } from "vitest";
import { sentMessage } from "@/components/chat/chat-request";
import type { KilnMessage } from "@/server/chat/messages";
import { mergeIncoming } from "@/server/chat/messages";

// Found in the end-to-end with real models: the Scenes specialist looked at
// a 1024 px take, asked for the maker's click, and the click sent the whole
// reply back, take included: the route refused it (413) and the approval
// never ran.
describe("sentMessage", () => {
  const take = "A".repeat(1_500_000);
  const reply = {
    id: "r1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-view_frame",
        toolCallId: "c1",
        state: "output-available",
        input: { frame: "etsy.hero" },
        output: {
          frame: "etsy.hero",
          images: [{ mimeType: "image/png", data: take }],
        },
      },
      { type: "text", text: "It looks right." },
      {
        type: "tool-approve_frame",
        toolCallId: "c2",
        state: "approval-responded",
        input: { frame: "etsy.hero" },
        approval: { id: "a1", approved: true },
      },
    ],
  } as unknown as KilnMessage;

  it("sends only the maker's answers to a reply, small whatever the agent looked at", () => {
    const sent = sentMessage(reply);
    expect(sent.parts).toEqual([
      {
        type: "tool-approve_frame",
        toolCallId: "c2",
        state: "approval-responded",
        approval: { id: "a1", approved: true },
      },
    ]);
    expect(JSON.stringify(sent).length).toBeLessThan(1_000);
  });

  it("is still the answer the server takes", () => {
    const stored = [
      {
        ...reply,
        parts: reply.parts.map((p) =>
          p.type === "tool-approve_frame"
            ? { ...p, state: "approval-requested", approval: { id: "a1" } }
            : p,
        ),
      },
    ] as KilnMessage[];
    const merged = mergeIncoming(stored, sentMessage(reply));
    expect("messages" in merged && merged.messages[0].parts[3]).toMatchObject({
      state: "approval-responded",
      approval: { id: "a1", approved: true },
    });
  });

  it("sends the maker's own message as it is", () => {
    const mine = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Approve the hero." }],
    } as KilnMessage;
    expect(sentMessage(mine)).toBe(mine);
  });
});
