import { afterEach, describe, expect, it, vi } from "vitest";

const setBrief = vi.fn(
  async (_projectId: string, _destinationId: string, _brief: unknown) => {},
);
const rememberSearchColumns = vi.fn(
  async (_source: string, _columns: unknown) => {},
);
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/server/project-repository", () => ({ setBrief }));
vi.mock("@/server/maker-repository", () => ({ rememberSearchColumns }));

const { saveBriefAction } = await import("@/app/actions/market-brief");

const search = (term: string, extra = {}) => ({
  term,
  source: "Etsy Marketplace Insights",
  readOn: "2026-09-27",
  ...extra,
});
const save = (brief: unknown, extra = {}) =>
  saveBriefAction({ projectId: "p", destinationId: "etsy", brief, ...extra });

afterEach(() => vi.clearAllMocks());

describe("saveBriefAction", () => {
  it("saves the brief, and the mapping its table was read with", async () => {
    const columns = { term: "Term", searches: "Searches" };
    expect(
      await save(
        { searches: [search("cutting board", { searches: 27900 })] },
        { columns: { source: "EverBee", columns } },
      ),
    ).toBeUndefined();
    expect(setBrief).toHaveBeenCalledWith("p", "etsy", {
      searches: [search("cutting board", { searches: 27900 })],
      notes: [],
    });
    expect(rememberSearchColumns).toHaveBeenCalledWith("EverBee", columns);
  });

  it("an empty brief clears it", async () => {
    await save({ searches: [], notes: [], carriedFrom: "An older project" });
    expect(setBrief).toHaveBeenCalledWith("p", "etsy", undefined);
    expect(rememberSearchColumns).not.toHaveBeenCalled();
  });

  it("says what is wrong, and where", async () => {
    expect(await save({ searches: [search("a"), search("")] })).toEqual({
      error: "Search 2 needs its term.",
    });
    expect(
      await save({ searches: [search("board"), search("Board ")] }),
    ).toEqual({ error: "A search is listed twice." });
    expect(
      await save({ notes: [{ note: " ", readOn: "2026-10-01" }] }),
    ).toEqual({ error: "Note 1 needs a few words." });
    expect(
      await save({ searches: [search("a", { readOn: "yesterday" })] }),
    ).toEqual({ error: "Search 1 needs its date (YYYY-MM-DD)." });
    expect(
      await save({
        searches: Array.from({ length: 41 }, (_, i) => search(`t${i}`)),
      }),
    ).toEqual({
      error: "A brief holds at most 40 searches and 12 notes.",
    });
    expect(await saveBriefAction({ projectId: "p" })).toEqual({
      error: "The brief could not be read.",
    });
    expect(setBrief).not.toHaveBeenCalled();
  });
});
