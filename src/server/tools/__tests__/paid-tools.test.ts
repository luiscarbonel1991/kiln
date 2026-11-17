import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/server/tools/registry";

// quote and the paid tools on stubbed services: what a quote stores and
// answers, and that each paid tool runs what was quoted, for a token that may
// spend, refused when the estimate rose.

const s = vi.hoisted(() => ({
  quotes: new Map<
    string,
    { action: string; input: unknown; maxMicros: number }
  >(),
  enqueued: [] as unknown[],
  textMax: 0.004,
  waiting: ["etsy.hero", "etsy.lifestyle"] as string[],
  wrote: [] as unknown[],
  reviewed: [] as unknown[],
  enqueueError: null as Error | null,
}));

vi.mock("@/server/spend-quotes", () => ({
  QUOTE_ACTIONS: ["generate", "draw", "write_listing", "review_product"],
  QUOTE_MINUTES: 30,
  QuoteRefusal: class QuoteRefusal extends Error {},
  createQuote: async (
    _maker: unknown,
    q: {
      action: string;
      input: unknown;
      maxMicros: number;
    },
  ) => {
    const id = `q${s.quotes.size + 1}`;
    s.quotes.set(id, q);
    return { id, expiresAt: new Date("2026-10-29T12:30:00Z") };
  },
  claimQuote: async (_maker: unknown, id: string, action: string) => {
    const q = s.quotes.get(id);
    if (!q || q.action !== action) throw new Error("no such quote");
    return { id, ...q, typicalMicros: 0, expiresAt: new Date() };
  },
}));
vi.mock("@/providers/mode", () => ({ providerMode: () => "live" }));
vi.mock("@/server/maker-repository", () => ({
  getCurrentMaker: async () => ({ id: "m1" }),
}));
vi.mock("@/server/generation-repository", () => {
  class QueueRefusal extends Error {
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    QueueRefusal,
    budget: async () => ({
      capMicros: 25_000_000,
      spentMicros: 24_900_000,
      reservedMicros: 0,
    }),
  };
});
vi.mock("@/server/project-frames", () => ({
  framedProjects: async () => [],
  projectFrames: async () => null,
  waitingProjectFrames: async (_maker: unknown, id: string) =>
    id === "p1"
      ? { waiting: s.waiting, reference: true }
      : id === "bare"
        ? { waiting: [], reference: false }
        : null,
}));
const request = (provider: string, model: string) => ({
  kind: "image",
  model: { provider, model, quality: "medium" },
});
vi.mock("@/server/generation-queue", () => ({
  estimateProjectCards: async (
    _maker: unknown,
    _project: string,
    ids: string[],
  ) => ({
    cards: ids.map((cardId) => ({
      cardId,
      request: cardId.endsWith(".video")
        ? {
            kind: "video",
            model: {
              provider: "google",
              model: "gemini-omni-1.1-flash",
              quality: "medium",
              resolution: "720p",
            },
          }
        : request("openai", "gpt-image-2"),
      typicalMicros: 53_000,
      maxMicros: 70_000,
      next: [{ provider: "google", model: "gemini-3.1-flash-image" }],
    })),
  }),
  enqueueProjectCards: async (_maker: unknown, input: unknown) => {
    if (s.enqueueError) throw s.enqueueError;
    s.enqueued.push(input);
    return { batchId: "b1", queued: 2, skipped: [] };
  },
}));
vi.mock("@/server/text-calls", () => ({
  textRoute: async () => ({
    labels: ["GPT-6.1 Sol", "Gemini 3.5 Flash"],
    typical: 0.003,
    max: s.textMax,
  }),
  reviewProduct: async (_maker: unknown, fields: unknown) => {
    s.reviewed.push(fields);
    return { review: { suggestions: [], checks: [] }, label: "GPT-6 Luna" };
  },
}));
vi.mock("@/server/listing-write", () => ({
  listingTarget: async (_maker: unknown, project: string) =>
    project === "p1" ? {} : null,
  writeProjectListing: async (
    _maker: unknown,
    project: string,
    destination: string,
    _model?: unknown,
    sessionId?: string,
  ) => {
    s.wrote.push(
      sessionId ? [project, destination, sessionId] : [project, destination],
    );
    return { listing: { title: "A planter" } };
  },
}));
vi.mock("@/server/product-repository", () => ({
  getProduct: async () => null,
  findProduct: async () => null,
}));
vi.mock("@/server/designs", () => ({
  designView: async (_maker: unknown, id: string) =>
    id === "d1"
      ? {
          project: { id: "d1", name: "Fern", updatedAt: "" },
          master: null,
          subject: null,
          drawings: [
            { card: "recipe-line-art-0", label: "Outline", state: "to-draw" },
            { card: "recipe-line-art-1", label: "Detail", state: "drawn" },
            { card: "recipe-line-art-2", label: "Badge", state: "drawing" },
            { card: "recipe-line-art-3", label: "Minimal", state: "failed" },
          ],
        }
      : null,
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const { QueueRefusal } = await import("@/server/generation-repository");

const SPENDER = {
  maker: { id: "test" },
  tokenId: "t1",
  tokenName: "Agent",
  canSpend: true,
};
const call = (name: string, args: unknown, ctx: ToolContext = SPENDER) =>
  callTool(TOOLS, name, args, ctx);

afterEach(() => {
  s.quotes.clear();
  s.enqueued.length = 0;
  s.wrote.length = 0;
  s.textMax = 0.004;
  s.waiting = ["etsy.hero", "etsy.lifestyle"];
  s.enqueueError = null;
});

describe("quote", () => {
  it("prices every waiting scene with its models and stores what it priced", async () => {
    const answer = await call("quote", { action: "generate", project: "p1" });
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: {
          quote: "q1",
          frames: ["etsy.hero", "etsy.lifestyle"],
          typicalUsd: 0.106,
          atMostUsd: 0.14,
          lines: [
            {
              frame: "etsy.hero",
              model: "GPT Image 2 medium",
              fallbacks: ["Gemini 3.1 Flash Image"],
              atMostUsd: 0.07,
            },
            expect.anything(),
          ],
          capLeftUsd: 0.1,
          fitsCap: false,
          canSpend: true,
        },
      },
    });
    expect(s.quotes.get("q1")).toMatchObject({
      action: "generate",
      input: { project: "p1", frames: ["etsy.hero", "etsy.lifestyle"] },
      maxMicros: 140_000,
    });
  });

  it("names a video line by its resolution", async () => {
    const answer = await call("quote", {
      action: "generate",
      project: "p1",
      frames: ["etsy.video"],
    });
    expect(answer).toMatchObject({
      ok: true,
      output: { data: { lines: [{ model: "Gemini Omni Flash 720p" }] } },
    });
  });

  it("refuses what it cannot price, in words", async () => {
    s.waiting = [];
    expect(
      await call("quote", { action: "generate", project: "p1" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Nothing waits to be generated"),
    });
    expect(
      await call("quote", { action: "generate", project: "bare" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("no reference image yet"),
    });
    expect(await call("quote", { action: "generate" })).toEqual({
      ok: false,
      error: "A quote for generate needs project.",
    });
    expect(
      await call("quote", { action: "review_product", product: "x" }),
    ).toEqual({
      ok: false,
      error: "No product of yours has that id or SKU.",
    });
    expect(s.quotes.size).toBe(0);
  });
});

describe("generate", () => {
  it("queues what was quoted, with the quote's most as the shown estimate", async () => {
    await call("quote", {
      action: "generate",
      project: "p1",
      frames: ["etsy.hero"],
    });
    expect(await call("generate", { quote: "q1" })).toMatchObject({
      ok: true,
      output: { data: { batch: "b1", queued: 2 } },
    });
    expect(s.enqueued).toEqual([
      { projectId: "p1", cardIds: ["etsy.hero"], shownMaxMicros: 70_000 },
    ]);
  });

  it("is refused for a token that may not spend, and when the estimate rose", async () => {
    await call("quote", { action: "generate", project: "p1" });
    expect(
      await call("generate", { quote: "q1" }, { ...SPENDER, canSpend: false }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("may not spend"),
    });
    s.enqueueError = new QueueRefusal(
      "estimate-changed",
      "The estimate changed since it was shown; review it again.",
    );
    expect(await call("generate", { quote: "q1" })).toEqual({
      ok: false,
      error: "The estimate rose since the quote: quote again.",
    });
    expect(s.enqueued).toEqual([]);
  });

  it("takes only a quote: no frames, no model", async () => {
    expect(
      await call("generate", { quote: "q1", model: "gpt-image-2" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("generate needs"),
    });
  });
});

describe("draw", () => {
  it("prices a design's drawings that have no line art, and queues them on the quote", async () => {
    const answer = await call("quote", { action: "draw", project: "d1" });
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: {
          quote: "q1",
          cards: ["recipe-line-art-0", "recipe-line-art-3"],
          lines: [
            { card: "recipe-line-art-0", drawing: "Outline" },
            { card: "recipe-line-art-3", drawing: "Minimal" },
          ],
          atMostUsd: 0.14,
        },
      },
    });
    expect(await call("draw", { quote: "q1" })).toMatchObject({
      ok: true,
      output: { data: { batch: "b1" } },
    });
    expect(s.enqueued).toEqual([
      {
        projectId: "d1",
        cardIds: ["recipe-line-art-0", "recipe-line-art-3"],
        shownMaxMicros: 140_000,
      },
    ]);
  });

  it("draws a drawn one again when named, never one being drawn", async () => {
    expect(
      await call("quote", {
        action: "draw",
        project: "d1",
        cards: ["recipe-line-art-1"],
      }),
    ).toMatchObject({ ok: true, output: { data: { atMostUsd: 0.07 } } });
    expect(
      await call("quote", {
        action: "draw",
        project: "d1",
        cards: ["recipe-line-art-2"],
      }),
    ).toEqual({ ok: false, error: "Badge is being drawn already." });
    expect(
      await call("quote", { action: "draw", project: "d1", cards: ["nope"] }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a drawing"),
    });
    expect(await call("quote", { action: "draw", project: "p1" })).toEqual({
      ok: false,
      error: "No design of yours has that id.",
    });
  });

  it("takes only a draw quote", async () => {
    await call("quote", { action: "generate", project: "p1" });
    expect(await call("draw", { quote: "q1" })).toMatchObject({ ok: false });
    expect(s.enqueued).toEqual([]);
  });
});

describe("write_listing", () => {
  it("writes the quoted destination, and refuses when the text price rose", async () => {
    await call("quote", {
      action: "write_listing",
      project: "p1",
      destination: "etsy",
    });
    expect(s.quotes.get("q1")).toMatchObject({ maxMicros: 4000 });
    s.textMax = 0.01;
    expect(await call("write_listing", { quote: "q1" })).toEqual({
      ok: false,
      error: "The estimate rose since the quote: quote again.",
    });
    s.textMax = 0.004;
    await call("quote", {
      action: "write_listing",
      project: "p1",
      destination: "etsy",
    });
    expect(await call("write_listing", { quote: "q2" })).toMatchObject({
      ok: true,
      output: { data: { listing: { title: "A planter" } } },
    });
    expect(s.wrote).toEqual([["p1", "etsy"]]);
  });
});

describe("a paid tool run from the chat", () => {
  const CHAT = {
    ...SPENDER,
    tokenId: null,
    sessionId: "s1",
  };

  it("counts what it spends for that conversation", async () => {
    await call("quote", { action: "generate", project: "p1" }, CHAT);
    await call("generate", { quote: "q1" }, CHAT);
    expect(s.enqueued).toEqual([
      {
        projectId: "p1",
        cardIds: ["etsy.hero", "etsy.lifestyle"],
        shownMaxMicros: 140_000,
        sessionId: "s1",
      },
    ]);
    await call(
      "quote",
      { action: "write_listing", project: "p1", destination: "etsy" },
      CHAT,
    );
    await call("write_listing", { quote: "q2" }, CHAT);
    expect(s.wrote).toEqual([["p1", "etsy", "s1"]]);
  });
});
