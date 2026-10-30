import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "spend quotes and tool calls (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const quotes = await import("@/server/spend-quotes");
    const calls = await import("@/server/tool-calls");
    const { defineTool } = await import("@/server/tools/registry");
    const { z } = await import("zod");
    const { getCurrentMaker } = await import("@/server/maker-repository");
    let maker: { id: string };
    let other: { id: string };

    const quote = (
      over: Partial<Parameters<typeof quotes.createQuote>[0]> = {},
    ) =>
      quotes.createQuote({
        action: "generate",
        input: { project: "p1", cards: ["etsy.hero"] },
        typicalMicros: 70_000,
        maxMicros: 90_000,
        tokenId: "tok-quotes",
        ...over,
      });

    beforeAll(async () => {
      maker = await getCurrentMaker();
      other = await db.maker.upsert({
        where: { slug: "quotes-other-maker" },
        create: { slug: "quotes-other-maker", name: "Another maker" },
        update: {},
      });
    });

    afterAll(async () => {
      await db.spendQuote.deleteMany({
        where: { makerId: { in: [maker.id, other.id] }, tokenId: "tok-quotes" },
      });
      await db.toolCall.deleteMany({ where: { tokenId: "tok-quotes" } });
      await db.maker.delete({ where: { id: other.id } });
    });

    it("a quote runs once, with the input and estimate it was made with", async () => {
      const made = await quote();
      const claimed = await quotes.claimQuote(made.id, "generate");
      expect(claimed).toMatchObject({
        id: made.id,
        action: "generate",
        input: { project: "p1", cards: ["etsy.hero"] },
        maxMicros: 90_000,
      });
      await expect(quotes.claimQuote(made.id, "generate")).rejects.toThrow(
        "That quote was used already: quote again.",
      );
    });

    it("is refused for another action, after it expires, and for another maker", async () => {
      const made = await quote();
      await expect(quotes.claimQuote(made.id, "write_listing")).rejects.toThrow(
        "That quote is for generate, not write_listing",
      );
      const later = new Date(made.expiresAt.getTime() + 1000);
      await expect(
        quotes.claimQuote(made.id, "generate", later),
      ).rejects.toThrow(/^That quote expired at/);
      const theirs = await db.spendQuote.create({
        data: {
          makerId: other.id,
          tokenId: "tok-quotes",
          action: "generate",
          input: {},
          typicalMicros: 1,
          maxMicros: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await expect(quotes.claimQuote(theirs.id, "generate")).rejects.toThrow(
        "No quote of yours has that id: quote first.",
      );
      // The refused claims left the quote unused.
      expect((await quotes.claimQuote(made.id, "generate")).id).toBe(made.id);
    });

    it("only one of two calls with the same quote runs it", async () => {
      const made = await quote();
      const results = await Promise.allSettled([
        quotes.claimQuote(made.id, "generate"),
        quotes.claimQuote(made.id, "generate"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("records each call, with a large argument kept by its size and the quote it ran on", async () => {
      const made = await quote({ maxMicros: 350_000 });
      const tool = defineTool({
        name: "spend_test",
        title: "Spend test",
        description: "Answers, or refuses a word.",
        input: z.object({ quote: z.string(), note: z.string().optional() }),
        hints: {},
        run: async () => ({ data: { queued: 1 } }),
      });
      const ctx = { tokenId: "tok-quotes", tokenName: "Agent", canSpend: true };
      await calls.callAndRecord([tool], "spend_test", { quote: made.id }, ctx);
      await calls.callAndRecord(
        [tool],
        "spend_test",
        { quote: made.id, note: "x".repeat(5000) },
        ctx,
      );
      await calls.callAndRecord([tool], "spend_test", { note: 1 }, ctx);
      const rows = await db.toolCall.findMany({
        where: { tokenId: "tok-quotes" },
        orderBy: { at: "asc" },
      });
      expect(rows.map((r) => [r.ok, r.quoteId])).toEqual([
        [true, made.id],
        [true, made.id],
        [false, null],
      ]);
      expect(rows[1].args).toEqual({
        size: expect.any(Number),
        keys: ["quote", "note"],
      });
      expect(rows[2].error).toMatch(/^spend_test needs:/);
      const recent = await calls.recentToolCalls();
      expect(recent.find((c) => c.id === rows[0].id)).toMatchObject({
        tokenName: "Agent",
        tool: "spend_test",
        quotedMaxMicros: 350_000,
        count: 1,
      });
    });

    it("folds the same call back to back into one row with its count", async () => {
      const tool = defineTool({
        name: "poll_test",
        title: "Poll test",
        description: "Answers the same thing each time.",
        input: z.object({}),
        hints: { readOnly: true },
        run: async () => ({ data: {} }),
      });
      const ctx = {
        tokenId: "tok-quotes",
        tokenName: "Poller",
        canSpend: false,
      };
      for (let i = 0; i < 3; i++) {
        await calls.callAndRecord([tool], "poll_test", {}, ctx);
      }
      const [latest] = await calls.recentToolCalls();
      expect(latest).toMatchObject({ tool: "poll_test", count: 3 });
    });
  },
);
