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
        other: "kept by the repository, not read here",
      }),
    ).toEqual({
      heroSetting: { "etsy:home": "place" },
      searchColumns: {
        EverBee: { term: "Keyword", searches: "Search volume" },
      },
    });
    expect(readPreferences(null)).toEqual({
      heroSetting: {},
      searchColumns: {},
    });
    expect(readPreferences({ heroSetting: "nope" })).toEqual({
      heroSetting: {},
      searchColumns: {},
    });
  });
});
