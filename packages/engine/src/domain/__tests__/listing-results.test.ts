import { describe, expect, it } from "vitest";
import {
  addDays,
  changedFrames,
  compareReads,
  comparisonLine,
  daysIn,
  dueOn,
  ListingRead,
  ListingResults,
  lastDeliveredAt,
  readsDue,
  readWindow,
} from "@/domain/listing-results";

const read = (from: string, to: string, numbers: Partial<ListingRead>) =>
  ListingRead.parse({
    from,
    to,
    source: "Etsy Stats",
    readOn: to,
    ...numbers,
  });

describe("the results loop's windows", () => {
  it("counts days across months, both ends included", () => {
    expect(addDays("2026-10-27", 5)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysIn({ from: "2026-10-01", to: "2026-10-30" })).toBe(30);
  });

  it("reads the 30 days before the photos went up, then the first 14 and 30 after", () => {
    expect(readWindow("before", "2026-10-27")).toEqual({
      from: "2026-09-27",
      to: "2026-10-26",
    });
    expect(readWindow("day14", "2026-10-27")).toEqual({
      from: "2026-10-27",
      to: "2026-11-09",
    });
    expect(readWindow("day30", "2026-10-27")).toEqual({
      from: "2026-10-27",
      to: "2026-11-25",
    });
    expect(dueOn("before", "2026-10-27")).toBe("2026-10-27");
    expect(dueOn("day14", "2026-10-27")).toBe("2026-11-10");
    expect(dueOn("day30", "2026-10-27")).toBe("2026-11-26");
  });

  it("a read is due once its window has passed, until it is taken", () => {
    const liveOn = "2026-10-27";
    expect(readsDue(undefined, liveOn, "2026-10-27")).toMatchObject({
      due: [{ key: "before" }],
      next: { key: "day14", dueOn: "2026-11-10" },
    });
    const taken = ListingResults.parse({
      reads: { before: read("2026-09-27", "2026-10-26", { visits: 40 }) },
    });
    expect(readsDue(taken, liveOn, "2026-11-30").due.map((r) => r.key)).toEqual(
      ["day14", "day30"],
    );
    expect(readsDue({ ...taken, stopped: true }, liveOn, "2026-11-30")).toEqual(
      { due: [], next: null },
    );
  });

  it("the listing went live with its last delivery", () => {
    expect(
      lastDeliveredAt({
        slots: [
          { deliveredAt: "2026-10-20T10:00:00.000Z" },
          { deliveredAt: "2026-10-26T18:00:00.000Z" },
          { deliveredAt: "2026-10-30T09:00:00.000Z", off: true },
          {},
        ],
      }),
    ).toBe("2026-10-26T18:00:00.000Z");
    expect(lastDeliveredAt({ slots: [{}] })).toBeNull();
  });
});

describe("a read", () => {
  it("keeps a window that ends after it starts, and at least one number", () => {
    expect(() => read("2026-10-10", "2026-10-01", { visits: 3 })).toThrow(
      /ends before it starts/,
    );
    expect(() => read("2026-10-01", "2026-10-10", {})).toThrow(
      /at least one number/,
    );
    expect(() => read("2026-10-01", "2026-10-10", { visits: 2.5 })).toThrow();
  });
});

describe("before against after", () => {
  const before = read("2026-09-27", "2026-10-26", {
    visits: 15,
    orders: 1,
    favourites: 0,
  });

  it("brings each count to 30 days, so 14 days compare with 30", () => {
    const after = read("2026-10-27", "2026-11-09", {
      visits: 14,
      orders: 1,
      favourites: 2,
    });
    const { rows, thin } = compareReads(before, after);
    expect(rows.find((r) => r.metric === "visits")).toEqual({
      metric: "visits",
      before: 15,
      after: 30,
      change: 1,
    });
    expect(rows.find((r) => r.metric === "favourites")?.change).toBeNull();
    expect(rows.find((r) => r.metric === "conversion")).toMatchObject({
      before: 1 / 15,
      after: 1 / 14,
    });
    expect(thin).toBe(true);
    expect(comparisonLine({ rows, thin })).toBe(
      "Visits 15 → 30 a month (+100 %) · Conversion 6.7 % → 7.1 % (+7 %)",
    );
  });

  it("compares only what both reads have, and says when there are enough visits", () => {
    const busy = read("2026-09-27", "2026-10-26", { visits: 600, views: 900 });
    const after = read("2026-10-27", "2026-11-25", { visits: 450 });
    const { rows, thin } = compareReads(busy, after);
    expect(rows.map((r) => r.metric)).toEqual(["visits"]);
    expect(thin).toBe(false);
    expect(comparisonLine({ rows, thin })).toBe(
      "Visits 600 → 450 a month (−25 %)",
    );
    const big = compareReads(
      read("2026-09-27", "2026-10-26", { visits: 1200 }),
      after,
    );
    expect(comparisonLine(big)).toBe("Visits 1,200 → 450 a month (−63 %)");
  });
});

describe("what the refresh changed", () => {
  const slot = (key: string, extra: object = {}) => ({
    key,
    label: key,
    fill: "scene",
    ...extra,
  });

  it("in a refresh, the frames that replaced a live photo", () => {
    expect(
      changedFrames({
        slots: [
          slot("hero", {
            before: { url: "u", aspect: "4:5" },
            place: "a hallway",
          }),
          slot("live-2", { fill: "photo" }),
          slot("size", { fill: "exact", deliveredAt: "x" }),
        ],
      }),
    ).toEqual([{ key: "hero", label: "hero", place: "a hallway" }]);
  });

  it("in a listing made from the product, every frame delivered", () => {
    expect(
      changedFrames({
        slots: [
          slot("hero", { deliveredAt: "x" }),
          slot("in-use"),
          slot("size", { fill: "exact", deliveredAt: "x" }),
          slot("gift", { deliveredAt: "x", off: true }),
        ],
      }).map((f) => f.key),
    ).toEqual(["hero", "size"]);
  });
});
