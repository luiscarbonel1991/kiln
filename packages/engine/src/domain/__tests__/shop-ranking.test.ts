import { describe, expect, it } from "vitest";
import {
  bestSellers,
  countsAsSale,
  etsyText,
  favouredListings,
  listingNow,
  listingPhoto,
  moneyLabel,
  RankBy,
  RankWindow,
  rankBestSellers,
  rankShops,
  ShopRankBy,
  salesTotals,
  setAside,
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

describe("ranking what sold", () => {
  const rows = bestSellers([
    receipt(1, 100, [[1, 60, 1000, "Bulk sign"]]),
    receipt(2, 200, [[2, 1, 2500, "Door hanger"]]),
    receipt(3, 300, [[2, 1, 2500, "Door hanger"]]),
    receipt(4, 400, [[2, 2, 2500, "Door hanger"]]),
    receipt(5, 500, [[3, 1, 90000, "Big plaque"]]),
  ]);

  it("ranks by orders by default, so one bulk order does not lead; units and revenue on request", () => {
    expect(RankBy.parse(undefined)).toBe("orders");
    expect(RankBy.parse("units")).toBe("units");
    expect(RankBy.parse("views")).toBe("orders");
    // One order each: units break the tie.
    expect(rankBestSellers(rows, "orders").map((r) => r.title)).toEqual([
      "Door hanger",
      "Bulk sign",
      "Big plaque",
    ]);
    expect(rankBestSellers(rows, "units").map((r) => r.title)).toEqual([
      "Bulk sign",
      "Door hanger",
      "Big plaque",
    ]);
    expect(rankBestSellers(rows, "revenue").map((r) => r.title)).toEqual([
      "Big plaque",
      "Bulk sign",
      "Door hanger",
    ]);
  });

  it("totals a window: orders that are sales, their units and revenue, and listings sold", () => {
    expect(
      salesTotals([
        receipt(1, 100, [
          [1, 2, 1000],
          [2, 1, 500],
        ]),
        receipt(2, 200, [[1, 1, 1000]], "Paid"),
        receipt(3, 300, [[3, 9, 1000]], "Canceled"),
      ]),
    ).toEqual({
      orders: 2,
      units: 4,
      revenue: 35,
      currency: "USD",
      listings: 2,
    });
    const mixed = salesTotals([
      receipt(1, 1, [[1, 1, 100]]),
      {
        ...receipt(2, 2, [[2, 1, 100]]),
        transactions: [
          {
            listing_id: 2,
            quantity: 1,
            title: null,
            price: { amount: 100, divisor: 100, currency_code: "EUR" },
          },
        ],
      },
    ]);
    expect(mixed.currency).toBeNull();
  });

  it("a sold listing is live, sold out, inactive, made for one buyer, or gone", () => {
    const detail = (state: string, is_private = false) => ({
      listing_id: 1,
      state,
      is_private,
    });
    expect(listingNow(detail("active"), true)).toBe("live");
    expect(listingNow(detail("sold_out"), true)).toBe("sold-out");
    expect(listingNow(detail("inactive"), true)).toBe("inactive");
    expect(listingNow(detail("expired"), true)).toBe("inactive");
    expect(listingNow(detail("sold_out", true), true)).toBe("one-off");
    expect(listingNow(undefined, true)).toBe("gone");
    expect(listingNow(undefined, false)).toBe("unknown");
    expect(setAside("one-off", false)).toBe(true);
    expect(setAside("gone", false)).toBe(true);
    expect(setAside("live", true)).toBe(true);
    expect(setAside("sold-out", false)).toBe(false);
    expect(setAside("unknown", false)).toBe(false);
  });

  it("a listing's photo is its first, at list size", () => {
    expect(
      listingPhoto({
        listing_id: 1,
        state: "active",
        images: [
          { rank: 2, url_170x135: "second" },
          { rank: 1, url_170x135: "first", url_75x75: "tiny" },
        ],
      }),
    ).toBe("first");
    expect(
      listingPhoto({ listing_id: 1, state: "active", images: null }),
    ).toBeNull();
    expect(listingPhoto(undefined)).toBeNull();
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

  it("a shop's standing: lifetime sales since it opened, the past year's reviews, no lifetime average", () => {
    expect(shopStanding(shop("PineGoods", 2400, 2))).toEqual({
      shopId: "2401",
      name: "PineGoods",
      url: "https://www.etsy.com/shop/PineGoods",
      icon: null,
      sold: 2400,
      openedOn: "2024-10-26",
      favourites: 10,
      reviews: { count: 40, average: 4.9 },
      activeListings: 30,
      onVacation: false,
    });
    expect(shopStanding(shop("New", 0))).toMatchObject({
      openedOn: null,
      reviews: null,
    });
  });

  it("shops rank by the past year's reviews (none last), or by lifetime sales", () => {
    const standings = [
      { ...shop("Old", 9000, 15), review_count: 20 },
      { ...shop("Busy", 900, 1), review_count: 300 },
      shop("Quiet", 0),
      { ...shop("Mid", 2000, 4), review_count: 120 },
    ].map((s) => shopStanding(s));
    expect(rankShops(standings).map((s) => s.name)).toEqual([
      "Busy",
      "Mid",
      "Old",
      "Quiet",
    ]);
    expect(rankShops(standings, "lifetime").map((s) => s.name)).toEqual([
      "Old",
      "Mid",
      "Busy",
      "Quiet",
    ]);
    expect(ShopRankBy.parse("lifetime")).toBe("lifetime");
    expect(ShopRankBy.parse("nonsense")).toBe("recent");
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
        photo: null,
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
