import { z } from "zod";
import type { DestinationText } from "@/domain/destination";
import type { ListingIssue, ListingText } from "@/domain/listing";
import type { Product } from "@/domain/product";

// A listing's market brief (ROADMAP Phase 20, DOGFOOD #67): the searches it
// aims at, what page 1 shows for them, and where each number came from. The
// maker brings it (a table pasted from their notes, a CSV of their research
// tool, or typed); Kiln never reads a marketplace's pages. It feeds a frame's
// place, the tags and the title, and a price guardrail; it never sets a price.

export const Conversion = z.enum([
  "very-low",
  "low",
  "typical",
  "high",
  "very-high",
]);
export type Conversion = z.infer<typeof Conversion>;

export const CONVERSION_LABELS: Record<Conversion, string> = {
  "very-low": "Very low",
  low: "Low",
  typical: "Typical",
  high: "High",
  "very-high": "Very high",
};

export const PriceBand = z
  .object({ low: z.number().nonnegative(), high: z.number().nonnegative() })
  .refine((b) => b.low <= b.high, {
    message: "the band's low is above its high",
  });
export type PriceBand = z.infer<typeof PriceBand>;

const Day = z.iso.date();

export const TargetSearch = z.object({
  term: z.string().trim().min(1).max(80),
  // A month's searches on the marketplace.
  searches: z.number().int().nonnegative().optional(),
  // How many listings the marketplace matches to the term.
  results: z.number().int().nonnegative().optional(),
  // The source's rating of how often the search ends in a purchase, or the
  // rate itself (a percentage) when the source gives one.
  conversion: Conversion.optional(),
  conversionRate: z.number().min(0).max(100).optional(),
  // The median purchase price, a band as the source gives it.
  price: PriceBand.optional(),
  source: z.string().trim().min(1).max(60),
  readOn: Day,
});
export type TargetSearch = z.infer<typeof TargetSearch>;

// What the heroes on page 1 for a search show, in words: a recipe for a
// frame (its place), never an image to copy.
export const PageOneNote = z.object({
  term: z.string().trim().max(80).default(""),
  note: z.string().trim().min(1).max(400),
  place: z.string().trim().max(160).default(""),
  readOn: Day,
});
export type PageOneNote = z.infer<typeof PageOneNote>;

export const MAX_SEARCHES = 40;
export const MAX_NOTES = 12;

// "Desk  Name plate " and "desk name plate" are one search.
export const termKey = (term: string) =>
  term.trim().toLowerCase().replace(/\s+/g, " ");

export const MarketBrief = z
  .object({
    // In order: the first is the search the listing leads with.
    searches: z.array(TargetSearch).max(MAX_SEARCHES).default([]),
    notes: z.array(PageOneNote).max(MAX_NOTES).default([]),
    // The project it was brought from when this one started.
    carriedFrom: z.string().trim().min(1).max(120).optional(),
  })
  .refine(
    (b) =>
      new Set(b.searches.map((s) => termKey(s.term))).size ===
      b.searches.length,
    { message: "a search is listed twice" },
  );
export type MarketBrief = z.infer<typeof MarketBrief>;

export const isEmptyBrief = (brief: MarketBrief | undefined) =>
  !brief || (brief.searches.length === 0 && brief.notes.length === 0);

// --- Reading a table the maker pastes or drops in ---------------------------

export interface SearchTable {
  headers: string[];
  rows: string[][];
}

export const MAX_TABLE_ROWS = 500;

const clean = (cell: string) =>
  cell
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/""/g, '"')
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .trim();

// One delimited line, quotes respected ("a, b" is one cell).
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '""';
        i++;
      } else {
        quoted = !quoted;
        cell += c;
      }
    } else if (c === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells.map(clean);
}

const isRule = (cells: string[]) =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");

// A table as it comes: a CSV or TSV export, cells copied from a spreadsheet,
// or a Markdown table from the maker's notes. The first row names the
// columns; blank lines and Markdown rules are skipped.
export function parseTable(text: string): SearchTable {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0];
  const markdown = first.trim().startsWith("|");
  const delimiter = markdown
    ? "|"
    : first.includes("\t")
      ? "\t"
      : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
        ? ";"
        : ",";
  const rows = lines
    .map((line) => {
      const cells = splitLine(markdown ? line.trim() : line, delimiter);
      return markdown
        ? cells.slice(1, line.trim().endsWith("|") ? -1 : undefined)
        : cells;
    })
    .filter((cells) => !(markdown && isRule(cells)));
  const [headers, ...body] = rows;
  return {
    headers,
    rows: body
      .slice(0, MAX_TABLE_ROWS)
      .map((r) => headers.map((_, i) => r[i] ?? "")),
  };
}

export const SearchColumn = z.enum([
  "term",
  "searches",
  "results",
  "conversion",
  "price",
]);
export type SearchColumn = z.infer<typeof SearchColumn>;

// Which header holds each value; kept per source, so a tool's export is
// mapped once.
export const SearchColumns = z.object({
  term: z.string().min(1),
  searches: z.string().min(1).optional(),
  results: z.string().min(1).optional(),
  conversion: z.string().min(1).optional(),
  price: z.string().min(1).optional(),
});
export type SearchColumns = z.infer<typeof SearchColumns>;

const GUESS: [SearchColumn, RegExp][] = [
  ["term", /\b(terms?|keywords?|quer(y|ies)|phrases?)\b/i],
  ["conversion", /convers|convert/i],
  ["price", /price|purchase|\$/i],
  ["results", /results|competi|listings/i],
  ["searches", /search|volume|monthly|demand/i],
];

// The columns a table's headers name, each header used once.
export function guessColumns(headers: string[]): Partial<SearchColumns> {
  const taken = new Set<string>();
  const columns: Partial<SearchColumns> = {};
  for (const [column, pattern] of GUESS) {
    const header = headers.find((h) => !taken.has(h) && pattern.test(h));
    if (header) {
      columns[column] = header;
      taken.add(header);
    }
  }
  return columns;
}

// A saved mapping applies when the table has every header it names.
export function columnsFit(columns: SearchColumns, headers: string[]): boolean {
  return Object.values(columns).every((h) => h && headers.includes(h));
}

const bare = (cell: string) => cell.replace(/[*~≈+\s]/g, "").toLowerCase();

// "27.9k", "14,000", "1.2M"; a dash or a blank is no number.
export function readCount(cell: string): number | undefined {
  const m = bare(cell)
    .replace(/,/g, "")
    .match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  return Math.round(n);
}

// "Very low" … "Very high", or a rate ("0.49 %").
export function readConversion(
  cell: string,
): Pick<TargetSearch, "conversion" | "conversionRate"> {
  const label = Conversion.safeParse(
    cell.trim().toLowerCase().replace(/\s+/g, "-").replace(/\*/g, ""),
  );
  if (label.success) return { conversion: label.data };
  const rate = bare(cell).match(/^(\d+(?:[.,]\d+)?)%$/);
  if (rate) {
    const value = Number(rate[1].replace(",", "."));
    if (value <= 100) return { conversionRate: value };
  }
  return {};
}

// "$14.40–17.60", "15", "$9 to $12"; a dash alone is no price.
export function readPriceBand(cell: string): PriceBand | undefined {
  const numbers = bare(cell)
    .replace(/[$€£]|usd|eur|gbp/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .split(/–|—|-|to/)
    .filter(Boolean)
    .map(Number);
  if (numbers.length === 0 || numbers.length > 2) return undefined;
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const [low, high = low] = [...numbers].sort((a, b) => a - b);
  return { low, high };
}

// A table's rows as searches, read with the maker's mapping; a row without a
// term, or with a value the brief cannot hold, is skipped and counted.
export function searchesFromTable(
  table: SearchTable,
  columns: SearchColumns,
  meta: { source: string; readOn: string },
): { searches: TargetSearch[]; skipped: number } {
  const at = (column: SearchColumn) => {
    const header = columns[column];
    return header === undefined ? -1 : table.headers.indexOf(header);
  };
  const index = Object.fromEntries(
    SearchColumn.options.map((c) => [c, at(c)]),
  ) as Record<SearchColumn, number>;
  const cell = (row: string[], column: SearchColumn) =>
    index[column] === -1 ? "" : (row[index[column]] ?? "");
  const seen = new Set<string>();
  const searches: TargetSearch[] = [];
  let skipped = 0;
  for (const row of table.rows) {
    const parsed = TargetSearch.safeParse({
      term: cell(row, "term"),
      searches: readCount(cell(row, "searches")),
      results: readCount(cell(row, "results")),
      ...readConversion(cell(row, "conversion")),
      price: readPriceBand(cell(row, "price")),
      source: meta.source,
      readOn: meta.readOn,
    });
    if (!parsed.success || seen.has(termKey(parsed.data.term))) {
      skipped++;
      continue;
    }
    seen.add(termKey(parsed.data.term));
    searches.push(parsed.data);
  }
  return { searches, skipped };
}

// New readings laid over the brief's searches: a search already there takes
// the newer numbers where it stands; the rest are added after, up to the most
// a brief holds.
export function mergeSearches(
  current: TargetSearch[],
  added: TargetSearch[],
): { searches: TargetSearch[]; updated: number; added: number } {
  const byKey = new Map(added.map((s) => [termKey(s.term), s]));
  let updated = 0;
  const kept = current.map((s) => {
    const newer = byKey.get(termKey(s.term));
    if (!newer) return s;
    updated++;
    byKey.delete(termKey(s.term));
    return newer;
  });
  const fresh = [...byKey.values()].slice(0, MAX_SEARCHES - kept.length);
  return {
    searches: [...kept, ...fresh],
    updated,
    added: fresh.length,
  };
}

// --- What the brief feeds -------------------------------------------------

export const searchFor = (brief: MarketBrief | undefined, term: string) =>
  brief?.searches.find((s) => termKey(s.term) === termKey(term));

export interface PriceCheck {
  term: string;
  band: PriceBand;
  price: number;
  where: "below" | "inside" | "above";
}

// The product's price beside the band that sells for the first search that
// has one: a guardrail the maker reads (Kiln never sets a price).
export function priceCheck(
  product: Product,
  brief: MarketBrief | undefined,
): PriceCheck | null {
  const search = brief?.searches.find((s) => s.price);
  if (!search?.price || product.price === undefined) return null;
  const { low, high } = search.price;
  const price = product.price;
  return {
    term: search.term,
    band: search.price,
    price,
    where: price > high ? "above" : price < low ? "below" : "inside",
  };
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export const bandLabel = (band: PriceBand) =>
  band.low === band.high
    ? money(band.low)
    : `${money(band.low)}–${money(band.high)}`;

// The brief's searches that would fit as tags and are not tags yet, the most
// searched first.
export function tagSuggestions(
  brief: MarketBrief | undefined,
  tags: string[],
  rules: DestinationText,
  limit = 6,
): TargetSearch[] {
  if (!brief) return [];
  const have = new Set(tags.map(termKey));
  const pattern = new RegExp(rules.tags.pattern, "u");
  return brief.searches
    .filter(
      (s) =>
        !have.has(termKey(s.term)) &&
        s.term.length <= rules.tags.maxChars &&
        pattern.test(s.term),
    )
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.searches ?? -1) - (a.s.searches ?? -1) || a.i - b.i)
    .slice(0, limit)
    .map(({ s }) => s);
}

// What the brief advises about a listing's text: a title that does not name
// the search the listing leads with, and a price outside the band that sells.
// Warnings only; the words and the price are the maker's.
export function briefIssues(
  listing: ListingText,
  product: Product,
  brief: MarketBrief | undefined,
): ListingIssue[] {
  const issues: ListingIssue[] = [];
  const lead = brief?.searches[0];
  if (lead && !termKey(listing.title.value).includes(termKey(lead.term))) {
    issues.push({
      field: "title",
      severity: "warning",
      message: `The title does not name "${lead.term}", the search the brief leads with.`,
    });
  }
  const check = priceCheck(product, brief);
  if (check && check.where !== "inside") {
    issues.push({
      field: "price",
      severity: "warning",
      message: `${money(check.price)} is ${check.where} the ${bandLabel(check.band)} band that sells for "${check.term}". The price is yours; this is what buyers paid.`,
    });
  }
  return issues;
}
