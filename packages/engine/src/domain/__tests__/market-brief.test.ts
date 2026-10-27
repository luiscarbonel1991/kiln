import { describe, expect, it } from "vitest";
import { listingDraft } from "@/domain/listing";
import {
  briefIssues,
  columnsFit,
  guessColumns,
  MAX_SEARCHES,
  MarketBrief,
  mergeSearches,
  parseTable,
  priceCheck,
  readConversion,
  readCount,
  readPriceBand,
  searchesFromTable,
  type TargetSearch,
  tagSuggestions,
} from "@/domain/market-brief";
import { SEED_DESTINATIONS } from "@/domain/seed";
import { CUTTING_BOARD } from "./fixtures/cutting-board";

const rules = SEED_DESTINATIONS.find((d) => d.id === "etsy")?.text;
if (!rules) throw new Error("etsy has listing rules");
const meta = { source: "Etsy Marketplace Insights", readOn: "2026-09-27" };
const search = (term: string, extra: Partial<TargetSearch> = {}) =>
  ({ term, ...meta, ...extra }) as TargetSearch;

// A table as a maker keeps it in their notes (Markdown, bold, dashes).
const NOTES = `
| Term | Searches | Trend | Results | Conversion | Median purchase | Ours |
|---|---|---|---|---|---|---|
| **cutting board** | **27.9k** | −6.8 % | 33.1k | Very low | $14.40–17.60 | 0 |
| personalized cutting board | 5,700 | -0.2 % | 27.0k | **High** | $44.00–52.00 | 0 |
| walnut serving board | 151 | +42.9 % | 7.3k | Low | – | 6 |
|  | 12 | | | | | |
`;

describe("parseTable", () => {
  it("reads a Markdown table from the maker's notes, rules and bold dropped", () => {
    const table = parseTable(NOTES);
    expect(table.headers).toEqual([
      "Term",
      "Searches",
      "Trend",
      "Results",
      "Conversion",
      "Median purchase",
      "Ours",
    ]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0][0]).toBe("cutting board");
    expect(table.rows[0][1]).toBe("27.9k");
  });

  it("reads a CSV with quoted commas, a TSV from a spreadsheet, and a semicolon export", () => {
    const csv = parseTable(
      'Keyword,Search volume,Competition\n"board, end grain",1200,"8,300"\n',
    );
    expect(csv.headers).toEqual(["Keyword", "Search volume", "Competition"]);
    expect(csv.rows).toEqual([["board, end grain", "1200", "8,300"]]);
    expect(parseTable("Term\tSearches\ncheese board\t2.1k").rows).toEqual([
      ["cheese board", "2.1k"],
    ]);
    expect(
      parseTable("Term;Searches;Results\nbread board;900;4,1k").rows[0],
    ).toEqual(["bread board", "900", "4,1k"]);
    expect(parseTable("\n  \n")).toEqual({ headers: [], rows: [] });
  });
});

describe("reading cells", () => {
  it("counts: thousands, separators, dashes", () => {
    expect(readCount("27.9k")).toBe(27900);
    expect(readCount("**14,000**")).toBe(14000);
    expect(readCount("1.2M")).toBe(1200000);
    expect(readCount("–")).toBeUndefined();
    expect(readCount("")).toBeUndefined();
    expect(readCount("+18.7 %")).toBeUndefined();
  });

  it("conversion: the source's rating or a rate", () => {
    expect(readConversion("Very low")).toEqual({ conversion: "very-low" });
    expect(readConversion("**High**")).toEqual({ conversion: "high" });
    expect(readConversion("0.49 %")).toEqual({ conversionRate: 0.49 });
    expect(readConversion("0,05%")).toEqual({ conversionRate: 0.05 });
    expect(readConversion("rising")).toEqual({});
  });

  it("price: a band, one price, or none", () => {
    expect(readPriceBand("$14.40–17.60")).toEqual({ low: 14.4, high: 17.6 });
    expect(readPriceBand("$9 to $12")).toEqual({ low: 9, high: 12 });
    expect(readPriceBand("15")).toEqual({ low: 15, high: 15 });
    expect(readPriceBand("$1,200.00")).toEqual({ low: 1200, high: 1200 });
    expect(readPriceBand("–")).toBeUndefined();
    expect(readPriceBand("n/a")).toBeUndefined();
  });
});

describe("guessColumns and searchesFromTable", () => {
  it("guesses the columns from the headers, each used once", () => {
    const { headers } = parseTable(NOTES);
    expect(guessColumns(headers)).toEqual({
      term: "Term",
      searches: "Searches",
      results: "Results",
      conversion: "Conversion",
      price: "Median purchase",
    });
    expect(guessColumns(["Keyword", "Search Volume", "Competition"])).toEqual({
      term: "Keyword",
      searches: "Search Volume",
      results: "Competition",
    });
    expect(guessColumns(["Search term", "Searches"])).toEqual({
      term: "Search term",
      searches: "Searches",
    });
  });

  it("a saved mapping fits only a table that has its headers", () => {
    expect(
      columnsFit({ term: "Term", searches: "Searches" }, ["Term", "Searches"]),
    ).toBe(true);
    expect(columnsFit({ term: "Keyword" }, ["Term", "Searches"])).toBe(false);
  });

  it("reads each row as a search with its source and date, and counts what it skips", () => {
    const table = parseTable(NOTES);
    const { searches, skipped } = searchesFromTable(
      table,
      guessColumns(table.headers) as { term: string },
      meta,
    );
    expect(skipped).toBe(1);
    expect(searches).toEqual([
      {
        term: "cutting board",
        searches: 27900,
        results: 33100,
        conversion: "very-low",
        price: { low: 14.4, high: 17.6 },
        ...meta,
      },
      {
        term: "personalized cutting board",
        searches: 5700,
        results: 27000,
        conversion: "high",
        price: { low: 44, high: 52 },
        ...meta,
      },
      {
        term: "walnut serving board",
        searches: 151,
        results: 7300,
        conversion: "low",
        ...meta,
      },
    ]);
  });

  it("a term twice in one table is read once", () => {
    const table = parseTable("Term,Searches\nboard,10\nBoard ,20");
    expect(searchesFromTable(table, { term: "Term" }, meta)).toMatchObject({
      searches: [{ term: "board" }],
      skipped: 1,
    });
  });
});

describe("MarketBrief", () => {
  it("holds a search once, whatever its case", () => {
    expect(
      MarketBrief.safeParse({
        searches: [search("Cutting board"), search("cutting  board")],
      }).success,
    ).toBe(false);
    expect(MarketBrief.parse({})).toEqual({ searches: [], notes: [] });
  });
});

describe("mergeSearches", () => {
  it("a newer reading replaces a search where it stands; new ones follow, up to the most", () => {
    const current = [search("a", { searches: 1 }), search("b")];
    const merged = mergeSearches(current, [
      search("c"),
      search("A", { searches: 9, readOn: "2026-10-26" }),
    ]);
    expect(merged.searches.map((s) => [s.term, s.searches])).toEqual([
      ["A", 9],
      ["b", undefined],
      ["c", undefined],
    ]);
    expect(merged).toMatchObject({ updated: 1, added: 1 });
    const full = Array.from({ length: MAX_SEARCHES }, (_, i) =>
      search(`t${i}`),
    );
    expect(mergeSearches(full, [search("one more")]).searches).toHaveLength(
      MAX_SEARCHES,
    );
  });
});

describe("what the brief feeds", () => {
  const board = { ...CUTTING_BOARD, price: 48 };
  const brief = MarketBrief.parse({
    searches: [
      search("personalized cutting board", {
        searches: 5700,
        price: { low: 44, high: 52 },
      }),
      search("cutting board", {
        searches: 27900,
        price: { low: 14.4, high: 17.6 },
      }),
      search("a search far too long to be a tag", { searches: 99999 }),
    ],
  });

  it("puts the price beside the band that sells for the first search with one", () => {
    expect(priceCheck(board, brief)).toEqual({
      term: "personalized cutting board",
      band: { low: 44, high: 52 },
      price: 48,
      where: "inside",
    });
    expect(priceCheck({ ...board, price: 60 }, brief)?.where).toBe("above");
    expect(priceCheck(CUTTING_BOARD, brief)).toBeNull();
    expect(priceCheck(board, undefined)).toBeNull();
  });

  it("suggests the searches that fit as tags and are not tags yet, the most searched first", () => {
    expect(
      tagSuggestions(brief, ["Personalized cutting board"], rules).map(
        (s) => s.term,
      ),
    ).toEqual(["cutting board"]);
    expect(tagSuggestions(undefined, [], rules)).toEqual([]);
  });

  it("warns when the title does not name the lead search, or the price is outside the band", () => {
    const listing = listingDraft(board, rules);
    expect(briefIssues(listing, board, brief)).toEqual([
      {
        field: "title",
        severity: "warning",
        message:
          'The title does not name "personalized cutting board", the search the brief leads with.',
      },
    ]);
    const named = {
      ...listing,
      title: {
        value: "Personalized Cutting Board, walnut",
        source: "maker" as const,
      },
    };
    expect(briefIssues(named, { ...board, price: 30 }, brief)).toEqual([
      {
        field: "price",
        severity: "warning",
        message:
          '30.00 is below the 44.00–52.00 band that sells for "personalized cutting board". The price is yours; this is what buyers paid.',
      },
    ]);
    expect(briefIssues(named, board, brief)).toEqual([]);
    expect(briefIssues(listing, board, undefined)).toEqual([]);
  });
});
