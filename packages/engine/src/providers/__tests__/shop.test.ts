import { describe, expect, it } from "vitest";
import { ListingRead } from "@/domain/listing-results";
import { mockShop } from "@/providers/shop";

describe("the mock shop", () => {
  const url = "https://www.etsy.com/listing/4413933723/board";
  const window = { from: "2026-09-27", to: "2026-10-26" };

  it("gives the same numbers for the same listing and window, and a read that parses", async () => {
    const first = await mockShop.readListing(url, window);
    expect(await mockShop.readListing(url, window)).toEqual(first);
    expect(first.visits).toBeGreaterThan(0);
    expect(first.orders ?? 0).toBeLessThanOrEqual(first.visits ?? 0);
    expect(() =>
      ListingRead.parse({
        ...window,
        ...first,
        source: mockShop.label,
        readOn: "2026-10-27",
      }),
    ).not.toThrow();
  });

  it("a listing keeps its traffic: a 14-day window has about half the visits of 30", async () => {
    const month = await mockShop.readListing(url, window);
    const fortnight = await mockShop.readListing(url, {
      from: "2026-10-27",
      to: "2026-11-09",
    });
    const ratio = (fortnight.visits ?? 0) / (month.visits ?? 1);
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.9);
  });
});
