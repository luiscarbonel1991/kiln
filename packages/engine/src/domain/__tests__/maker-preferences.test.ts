import { describe, expect, it } from "vitest";
import { readPreferences } from "@/domain/maker-preferences";

describe("readPreferences", () => {
  it("keeps the choices it can read and drops the rest", () => {
    expect(
      readPreferences({
        heroSetting: { "etsy:home": "place", "etsy:old": "spotlight" },
        searchColumns: {
          EverBee: { term: "Keyword", searches: "Search volume" },
          Broken: { searches: "Searches" },
        },
        watchedShops: [
          { shopId: "7", name: "PineGoods" },
          { shopId: "seven", name: "Broken" },
        ],
        leftOutListings: ["4143619041", "not-an-id"],
        other: "kept by the repository, not read here",
      }),
    ).toEqual({
      heroSetting: { "etsy:home": "place" },
      searchColumns: {
        EverBee: { term: "Keyword", searches: "Search volume" },
      },
      watchedShops: [{ shopId: "7", name: "PineGoods" }],
      leftOutListings: ["4143619041"],
    });
    expect(readPreferences(null)).toEqual({
      heroSetting: {},
      searchColumns: {},
      watchedShops: [],
      leftOutListings: [],
    });
    expect(
      readPreferences({ heroSetting: "nope", watchedShops: "nope" }),
    ).toEqual({
      heroSetting: {},
      searchColumns: {},
      watchedShops: [],
      leftOutListings: [],
    });
  });
});
