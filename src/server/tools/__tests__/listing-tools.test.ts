import { afterEach, describe, expect, it, vi } from "vitest";

// save_brief, save_read and the shop reads on stubbed services: what each
// passes on, and refusals in words.

const s = vi.hoisted(() => ({
  briefs: [] as unknown[],
  reads: [] as unknown[],
  shop: true,
}));
vi.mock("@/server/project-repository", () => ({
  setBrief: async (project: string, destination: string, brief: unknown) => {
    if (project === "gone") throw new Error("project not found");
    s.briefs.push([project, destination, brief]);
  },
}));
vi.mock("@/server/listing-results", async (original) => {
  const real = await original<typeof import("@/server/listing-results")>();
  return {
    ...real,
    followedListings: async () => [],
    saveRead: async (input: { destinationId: string; read: unknown }) => {
      if (input.destinationId === "instagram") {
        throw new real.ResultsRefusal('"instagram" is not a sale destination.');
      }
      s.reads.push(input);
      return input.read;
    },
  };
});
vi.mock("@/server/shop-ranking", () => ({
  yourBestSellers: async () => (s.shop ? { shopName: "Ours", rows: [] } : null),
  watchedShops: async () => null,
  findShops: async () => [],
  shopFavourites: async () => ({ listings: [], read: 0, complete: true }),
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = { tokenId: "t1", tokenName: "agent", canSpend: false };
const call = (name: string, args: unknown) => callTool(TOOLS, name, args, CTX);

afterEach(() => {
  s.briefs.length = 0;
  s.reads.length = 0;
  s.shop = true;
});

const search = {
  term: "ceramic planter",
  searches: 1200,
  source: "eRank",
  readOn: "2026-10-28",
};

describe("save_brief", () => {
  it("saves a brief, clears an empty one, and refuses an unknown project", async () => {
    await call("save_brief", {
      project: "p1",
      destination: "etsy",
      brief: { searches: [search] },
    });
    await call("save_brief", { project: "p1", destination: "etsy", brief: {} });
    expect(s.briefs).toEqual([
      ["p1", "etsy", expect.objectContaining({ searches: [search] })],
      ["p1", "etsy", undefined],
    ]);
    expect(
      await call("save_brief", {
        project: "gone",
        destination: "etsy",
        brief: {},
      }),
    ).toEqual({ ok: false, error: "No project of yours has that id." });
  });

  it("refuses a search listed twice, as the board does", async () => {
    expect(
      await call("save_brief", {
        project: "p1",
        destination: "etsy",
        brief: { searches: [search, { ...search, term: " Ceramic  planter" }] },
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("listed twice"),
    });
  });
});

describe("save_read", () => {
  it("keeps a read, sourced from MCP, and refuses where it cannot", async () => {
    await call("save_read", {
      project: "p1",
      destination: "etsy",
      read: "day14",
      numbers: { visits: 120, orders: 3 },
    });
    expect(s.reads).toEqual([
      expect.objectContaining({
        key: "day14",
        source: "MCP",
        read: { visits: 120, orders: 3 },
      }),
    ]);
    expect(
      await call("save_read", {
        project: "p1",
        destination: "instagram",
        read: "before",
        numbers: {},
      }),
    ).toEqual({ ok: false, error: '"instagram" is not a sale destination.' });
  });
});

describe("the shop reads", () => {
  it("say when no shop is connected, and check a shop id", async () => {
    s.shop = false;
    expect(await call("best_sellers", {})).toEqual({
      ok: false,
      error: "No shop is connected: the maker connects one in Shops.",
    });
    expect(await call("shop_favourites", { shop: "my-shop" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("A shop's Etsy id is a number."),
    });
  });
});
