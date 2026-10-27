import { describe, expect, it } from "vitest";
import { ListingRead } from "@/domain/listing-results";
import type { PlanDestination } from "@/domain/plan";
import { dayLabel, resultsView } from "@/lib/results-view";

const read = (from: string, to: string, visits: number, orders = 1) =>
  ListingRead.parse({
    from,
    to,
    visits,
    orders,
    source: "Etsy stats",
    readOn: "2026-10-27",
  });

// A destination delivered at noon UTC on 10/10 (the same day in any zone
// a maker works in).
const destination = (extra: Partial<PlanDestination> = {}): PlanDestination =>
  ({
    destinationId: "etsy",
    shotListId: "etsy-listing",
    slots: [
      {
        key: "hero",
        label: "Marketplace hero",
        fill: "scene",
        deliveredAt: "2026-10-10T12:00:00.000Z",
      },
    ],
    ...extra,
  }) as PlanDestination;

describe("resultsView", () => {
  it("is nothing until the destination is delivered or the maker sets the day", () => {
    const undelivered = {
      slots: [
        {
          key: "hero",
          label: "Hero",
          fill: "scene",
          approvedOutput: "https://stub.local/hero.png",
        },
      ],
    } as Partial<PlanDestination>;
    expect(resultsView(destination(undelivered), "2026-10-27")).toBeNull();
    // Taken out of Kiln another way: followed from the day the maker sets,
    // and what changed is what was approved.
    expect(
      resultsView(
        destination({
          ...undelivered,
          results: { liveOn: "2026-10-20", reads: {} },
        }),
        "2026-10-27",
      ),
    ).toMatchObject({
      liveOn: "2026-10-20",
      liveOnSet: true,
      deliveredOn: null,
      changed: [{ key: "hero" }],
    });
  });

  it("counts from the delivery: what is due, what comes next, what changed", () => {
    const view = resultsView(destination(), "2026-10-27");
    expect(view).toMatchObject({
      liveOn: "2026-10-10",
      liveOnSet: false,
      following: true,
      next: { key: "day30", dueOn: "2026-11-09" },
      changed: [{ key: "hero", label: "Marketplace hero" }],
      comparison: null,
    });
    expect(view?.reads.filter((r) => r.due).map((r) => r.key)).toEqual([
      "before",
      "day14",
    ]);
  });

  it("compares before with the latest after, and flags a read over other days", () => {
    const view = resultsView(
      destination({
        listingUrl: "https://www.etsy.com/listing/4413933723/x",
        results: {
          liveOn: "2026-10-13",
          reads: {
            before: read("2026-09-10", "2026-10-09", 60, 2),
            day14: read("2026-10-13", "2026-10-26", 42, 2),
          },
        },
      }),
      "2026-10-27",
    );
    expect(view?.listingId).toBe("4413933723");
    expect(view?.liveOnSet).toBe(true);
    expect(view?.comparison).toMatchObject({
      against: "day14",
      thin: false,
      line: "Visits 60 → 90 a month (+50 %) · Conversion 3.3 % → 4.8 % (+43 %)",
    });
    expect(view?.reads.map((r) => [r.key, r.offWindow])).toEqual([
      ["before", true],
      ["day14", false],
      ["day30", false],
    ]);
    expect(view?.reads[0].window).toEqual({
      from: "2026-09-13",
      to: "2026-10-12",
    });
  });

  it("a listing no longer followed has nothing due", () => {
    const view = resultsView(
      destination({ results: { reads: {}, stopped: true } }),
      "2026-12-01",
    );
    expect(view?.following).toBe(false);
    expect(view?.reads.some((r) => r.due)).toBe(false);
    expect(view?.next).toBeNull();
  });

  it("names a day the short way", () => {
    expect(dayLabel("2026-11-09")).toBe("Nov 9");
  });
});
