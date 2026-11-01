import { describe, expect, it } from "vitest";
import { spentLine, textMicros } from "@/components/chat/chat-spend";
import type { KilnMessage } from "@/server/chat/messages";

// What the chat says a conversation has spent: the text its replies cost
// plus the work its paid tools ran, and what that work still holds.
describe("spentLine", () => {
  const reply = (costMicros?: number): KilnMessage => ({
    id: `r${costMicros}`,
    role: "assistant",
    parts: [],
    ...(costMicros === undefined ? {} : { metadata: { costMicros } }),
  });
  const maker: KilnMessage = { id: "u1", role: "user", parts: [] };

  it("adds each reply's text", () => {
    expect(textMicros([maker, reply(4_000), reply(), reply(12_500)])).toBe(
      16_500,
    );
  });

  it("says the text and the work together, and what is still queued", () => {
    expect(
      spentLine(16_500, { spentMicros: 512_000, queuedMicros: 0 }),
    ).toEqual({
      line: "spent here $0.53",
      detail: "This conversation: text $0.017 · work it ran $0.51.",
    });
    expect(spentLine(4_000, { spentMicros: 0, queuedMicros: 517_000 })).toEqual(
      {
        line: "spent here $0.004 · $0.52 queued",
        detail:
          "This conversation: text $0.004 · work it ran $0 · $0.52 queued.",
      },
    );
  });

  it("says when nothing was spent yet, and that a mock run pays nothing", () => {
    expect(spentLine(0, { spentMicros: 0, queuedMicros: 0 }).line).toBe(
      "nothing spent here yet",
    );
    expect(spentLine(9_000, null).line).toBe("mock run · nothing is paid");
  });
});
