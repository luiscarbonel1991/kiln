import { describe, expect, it } from "vitest";
import {
  bestSellers,
  countsAsSale,
  etsyText,
  favouredListings,
  moneyLabel,
  RankWindow,
  rankShops,
  shopStanding,
} from "@/domain/shop-ranking";

const usd = (amount: number) => ({
  amount,
  divisor: 100,
  currency_code: "USD",
});

const receipt = (
  id: number,
  at: number,
  lines: [number | null, number, number, string?][],
  status = "Completed",
) => ({
  receipt_id: id,
  status,
  created_timestamp: at,
  transactions: lines.map(([listing_id, quantity, cents, title]) => ({
    listing_id,
    quantity,
    price: usd(cents),
    title: title ?? null,
  })),
});

describe("bestSellers", () => {
  it("ranks listings by units sold, counting only receipts that are sales", () => {
    const rows = bestSellers([
      receipt(1, 100, [[11, 2, 2500, "Walnut coaster"]]),
      receipt(2, 200, [
        [11, 1, 2500, "Walnut coaster set"],
        [12, 1, 4000, "Mug &amp; saucer"],
      ]),
      receipt(3, 300, [[12, 1, 4000]], "Paid"),
      receipt(4, 400, [[12, 5, 4000]], "Canceled"),
      receipt(5, 500, [[12, 5, 4000]], "Fully refunded"),
      receipt(6, 600, [[13, 1, 900]], "Open"),
      receipt(7, 700, [[null, 1, 100]]),
    ]);
    expect(rows).toEqual([
      {
        listingId: "11",
        title: "Walnut coaster set",
        units: 3,
        orders: 2,
        revenue: 75,
        currency: "USD",
        lastSoldAt: 200,
      },
      {
        listingId: "12",
        title: "Mug & saucer",
        units: 2,
        orders: 2,
        revenue: 80,
        currency: "USD",
        lastSoldAt: 300,
      },
    ]);
  });

  it("one order with a listing twice counts once; a listing with no title is named by id", () => {
    const [row] = bestSellers([
      receipt(1, 100, [
        [21, 1, 1000],
        [21, 1, 1200],
      ]),
    ]);
    expect(row).toMatchObject({
      listingId: "21",
      title: "Listing 21",
      units: 2,
      orders: 1,
      revenue: 22,
    });
  });

  it("ties go to revenue, then title", () => {
    const rows = bestSellers([
      receipt(1, 1, [[1, 1, 1000, "B"]]),
      receipt(2, 1, [[2, 1, 3000, "C"]]),
      receipt(3, 1, [[3, 1, 1000, "A"]]),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["C", "A", "B"]);
  });

  it("a sale is paid, completed or partly refunded", () => {
    expect(
      ["Paid", "completed", "Partially Refunded"].map(countsAsSale),
    ).toEqual([true, true, true]);
    expect(
      ["Open", "Payment Processing", "Canceled", "Fully Refunded"].map(
        countsAsSale,
      ),
    ).toEqual([false, false, false, false]);
  });
});

describe("other shops", () => {
  const now = Date.UTC(2026, 9, 27) / 1000;
  const shop = (name: string, sold: number, yearsOpen?: number) => ({
    shop_id: sold + 1,
    shop_name: name,
    url: `https://www.etsy.com/shop/${name}`,
    create_date:
      yearsOpen === undefined
        ? undefined
        : now - Math.round(yearsOpen * 365.25 * 86_400),
    transaction_sold_count: sold,
    num_favorers: 10,
    review_count: sold > 0 ? 40 : null,
    review_average: sold > 0 ? 4.9 : null,
    listing_active_count: 30,
  });

  it("a shop's standing: lifetime sales, a month's average since it opened, the year's reviews", () => {
    expect(shopStanding(shop("PineGoods", 2400, 2), now)).toEqual({
      shopId: "2401",
      name: "PineGoods",
      url: "https://www.etsy.com/shop/PineGoods",
      sold: 2400,
      perMonth: 100,
      openedOn: "2024-10-26",
      favourites: 10,
      reviews: { count: 40, average: 4.9 },
      activeListings: 30,
      onVacation: false,
    });
    expect(shopStanding(shop("New", 0), now)).toMatchObject({
      perMonth: null,
      openedOn: null,
      reviews: null,
    });
  });

  it("shops rank by lifetime sales", () => {
    const ranked = rankShops(
      [shop("A", 10, 1), shop("B", 900, 1), shop("C", 90, 1)].map((s) =>
        shopStanding(s, now),
      ),
    );
    expect(ranked.map((s) => s.name)).toEqual(["B", "C", "A"]);
  });

  it("another shop's listings rank by favourites, never by sales Etsy does not give", () => {
    const listing = (id: number, favourites: number, title = `L${id}`) => ({
      listing_id: id,
      title,
      url: `https://www.etsy.com/listing/${id}`,
      num_favorers: favourites,
      price: usd(2450),
    });
    const ranked = favouredListings(
      [listing(1, 5), listing(2, 50, "Oak &quot;board&quot;"), listing(3, 20)],
      2,
    );
    expect(ranked).toEqual([
      {
        listingId: "2",
        title: 'Oak "board"',
        url: "https://www.etsy.com/listing/2",
        favourites: 50,
        price: 24.5,
        currency: "USD",
      },
      expect.objectContaining({ listingId: "3", favourites: 20 }),
    ]);
  });
});

describe("words and windows", () => {
  it("reads Etsy's escaped text", () => {
    expect(etsyText("Kid&#39;s mug &amp; spoon &#x2014; &lt;3")).toBe(
      "Kid's mug & spoon — <3",
    );
  });

  it("shows money as the shop does", () => {
    expect(moneyLabel(1234.5, "USD")).toBe("$1,235");
    expect(moneyLabel(12.5, "EUR")).toBe("€12.50");
    expect(moneyLabel(12, null)).toBe("12");
  });

  it("a window is 30, 90 or 365 days; anything else reads as 90", () => {
    expect(RankWindow.parse("30")).toBe(30);
    expect(RankWindow.parse(365)).toBe(365);
    expect(RankWindow.parse("7")).toBe(90);
    expect(RankWindow.parse(undefined)).toBe(90);
  });
});
