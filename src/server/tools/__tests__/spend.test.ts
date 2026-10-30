import { describe, expect, it, vi } from "vitest";

const claimed = vi.hoisted(() => [] as unknown[]);
vi.mock("@/server/spend-quotes", () => ({
  QuoteRefusal: class QuoteRefusal extends Error {},
  claimQuote: async (id: string, action: string) => {
    claimed.push([id, action]);
    return { id, action, input: {}, typicalMicros: 1, maxMicros: 2 };
  },
}));
vi.mock("@/server/generation-repository", () => ({
  QueueRefusal: class QueueRefusal extends Error {},
}));

const { takeQuote } = await import("@/server/tools/spend");

describe("takeQuote", () => {
  it("refuses a token that may not spend, leaving the quote untouched", async () => {
    await expect(
      takeQuote(
        { tokenId: "t", tokenName: "Nightly", canSpend: false },
        "q1",
        "generate",
      ),
    ).rejects.toThrow('The token "Nightly" may not spend');
    expect(claimed).toEqual([]);
  });

  it("takes the quote for its action when the token may spend", async () => {
    const quote = await takeQuote(
      { tokenId: "t", tokenName: "Agent", canSpend: true },
      "q1",
      "generate",
    );
    expect(quote.id).toBe("q1");
    expect(claimed).toEqual([["q1", "generate"]]);
  });
});
