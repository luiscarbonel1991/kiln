import { beforeEach, describe, expect, it, vi } from "vitest";

// Shops' actions without Etsy or a database: the reads and the maker's list
// are stubbed.
const kept = vi.hoisted(() => ({
  watched: [] as { shopId: string; name: string }[],
  added: [] as unknown[],
  leftOut: [] as string[],
  changes: [] as [string, boolean][],
}));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/server/maker-repository", () => ({
  getMakerPreferences: async () => ({
    heroSetting: {},
    searchColumns: {},
    watchedShops: kept.watched,
    leftOutListings: kept.leftOut,
  }),
  leaveOutListing: async (_maker: unknown, listingId: string, out: boolean) => {
    kept.changes.push([listingId, out]);
    return true;
  },
  watchShop: async (_maker: unknown, shop: unknown) => {
    kept.added.push(shop);
    return true;
  },
  unwatchShop: async () => true,
}));
vi.mock("@/server/shop-ranking", async () => {
  const { EtsyError } = await import("@/providers/shop/etsy");
  return {
    findShops: async (name: string) => {
      if (name === "limited") {
        throw new EtsyError(429, "Etsy is rate-limiting Kiln's requests");
      }
      return [{ shopId: "7", name }];
    },
    shopFavourites: async () => ({ listings: [], read: 0, complete: true }),
  };
});
vi.mock("@/server/shop-connection", () => ({
  disconnectShop: async () => false,
}));

const actions = await import("@/app/actions/shops");

beforeEach(() => {
  kept.watched = [];
  kept.added = [];
  kept.leftOut = [];
  kept.changes = [];
});

describe("Shops actions", () => {
  it("finds shops by a name of two letters or more, Etsy's refusals in its words", async () => {
    expect(await actions.findShopsAction(" p ")).toEqual({
      error: "Type at least two letters of the shop's name.",
    });
    expect(await actions.findShopsAction("pine")).toEqual({
      shops: [{ shopId: "7", name: "pine" }],
    });
    expect(await actions.findShopsAction("limited")).toEqual({
      error: "Etsy said: Etsy is rate-limiting Kiln's requests",
    });
  });

  it("adds a shop once, and at most twelve", async () => {
    expect(await actions.watchShopAction({ shopId: "x7", name: "A" })).toEqual({
      error: "Which shop?",
    });
    expect(
      await actions.watchShopAction({ shopId: "7", name: "Pine" }),
    ).toEqual({});
    expect(kept.added).toEqual([{ shopId: "7", name: "Pine" }]);
    kept.watched = [{ shopId: "7", name: "Pine" }];
    expect(
      await actions.watchShopAction({ shopId: "7", name: "Pine" }),
    ).toEqual({
      error: "Pine is already on the list.",
    });
    kept.watched = Array.from({ length: 12 }, (_, i) => ({
      shopId: String(100 + i),
      name: `S${i}`,
    }));
    expect(
      await actions.watchShopAction({ shopId: "7", name: "Pine" }),
    ).toEqual({
      error: "At most 12 shops: take one off first.",
    });
  });

  it("says when there was no shop to disconnect", async () => {
    expect(await actions.disconnectShopAction()).toEqual({
      error: "No shop was connected.",
    });
  });

  it("leaves a listing out of the ranking or puts it back, by its id only", async () => {
    expect(
      await actions.leaveOutListingAction({ listingId: "abc", out: true }),
    ).toEqual({ error: "Which listing?" });
    expect(
      await actions.leaveOutListingAction({
        listingId: "4143619041",
        out: true,
      }),
    ).toEqual({});
    expect(
      await actions.leaveOutListingAction({
        listingId: "4143619041",
        out: false,
      }),
    ).toEqual({});
    expect(kept.changes).toEqual([
      ["4143619041", true],
      ["4143619041", false],
    ]);
    kept.leftOut = Array.from({ length: 500 }, (_, i) => String(i + 1));
    expect(
      await actions.leaveOutListingAction({ listingId: "9999", out: true }),
    ).toEqual({ error: "At most 500 listings can be left out." });
  });
});
