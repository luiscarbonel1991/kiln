import { z } from "zod";

// Rankings read from a shop's API (ROADMAP Phase 20; Luis, 2026-10-27: "el
// ranking de Etsy por API oficial"). The maker's own shop: units sold per
// listing, from its receipts (exact). Another shop: Etsy gives its lifetime
// sales, its reviews and each listing's favourites, never what one listing
// sold, so its listings rank by favourites and say so. Pure: the server reads
// the API, these shape what it read.

export const RANK_WINDOWS = [30, 90, 365] as const;
export const RankWindow = z.coerce
  .number()
  .pipe(z.union(RANK_WINDOWS.map((d) => z.literal(d))))
  .catch(90);
export type RankWindow = (typeof RANK_WINDOWS)[number];

export const MAX_WATCHED_SHOPS = 12;

// A shop the maker compares against, by Etsy's id and the name it had.
export const WatchedShop = z.object({
  shopId: z.string().regex(/^\d+$/),
  name: z.string().trim().min(1).max(80),
});
export type WatchedShop = z.infer<typeof WatchedShop>;

interface Money {
  amount: number;
  divisor: number;
  currency_code: string;
}

const amountOf = (m: Money) =>
  m.divisor > 0 ? m.amount / m.divisor : m.amount;

// Etsy's titles come HTML-escaped ("Mug &amp; Saucer").
export function etsyText(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// --- The maker's shop: what sold ------------------------------------------

export interface ReceiptLike {
  receipt_id: number;
  status: string;
  created_timestamp: number;
  transactions: {
    listing_id: number | null;
    title?: string | null;
    quantity: number;
    price: Money;
  }[];
}

// A receipt that counts as a sale: paid, shipped, or partly refunded. Open
// (unpaid), in payment, canceled and fully refunded ones do not.
const SOLD = new Set(["paid", "completed", "partially refunded"]);
export const countsAsSale = (status: string) =>
  SOLD.has(status.trim().toLowerCase());

export interface ListingSales {
  listingId: string;
  title: string;
  units: number;
  orders: number;
  revenue: number;
  currency: string | null;
  // Epoch seconds of the last order.
  lastSoldAt: number;
}

// The listings that sold in the receipts given, most units first (then
// revenue, then title). Each listing is named by its newest title.
export function bestSellers(receipts: ReceiptLike[]): ListingSales[] {
  const rows = new Map<string, ListingSales & { titledAt: number }>();
  for (const receipt of receipts) {
    if (!countsAsSale(receipt.status)) continue;
    const seen = new Set<string>();
    for (const line of receipt.transactions) {
      if (line.listing_id === null || line.quantity <= 0) continue;
      const id = String(line.listing_id);
      const row = rows.get(id) ?? {
        listingId: id,
        title: "",
        units: 0,
        orders: 0,
        revenue: 0,
        currency: line.price.currency_code || null,
        lastSoldAt: 0,
        titledAt: -1,
      };
      row.units += line.quantity;
      row.revenue += amountOf(line.price) * line.quantity;
      if (!seen.has(id)) row.orders += 1;
      seen.add(id);
      row.lastSoldAt = Math.max(row.lastSoldAt, receipt.created_timestamp);
      if (line.title && receipt.created_timestamp > row.titledAt) {
        row.title = etsyText(line.title);
        row.titledAt = receipt.created_timestamp;
      }
      // Mixed currencies have no one total to show.
      if (row.currency !== line.price.currency_code) row.currency = null;
      rows.set(id, row);
    }
  }
  return [...rows.values()]
    .map(({ titledAt: _, ...row }) => ({
      ...row,
      title: row.title || `Listing ${row.listingId}`,
      revenue: Math.round(row.revenue * 100) / 100,
    }))
    .sort(
      (a, b) =>
        b.units - a.units ||
        b.revenue - a.revenue ||
        a.title.localeCompare(b.title),
    );
}

// --- Other shops ----------------------------------------------------------

export interface ShopLike {
  shop_id: number;
  shop_name: string;
  url: string;
  create_date?: number;
  transaction_sold_count: number;
  num_favorers: number;
  review_count?: number | null;
  review_average?: number | null;
  listing_active_count: number;
  is_vacation?: boolean;
}

export interface ShopStanding {
  shopId: string;
  name: string;
  url: string;
  // Lifetime sales, and their average per month since the shop opened.
  sold: number;
  perMonth: number | null;
  openedOn: string | null;
  favourites: number;
  // Reviews of the past year.
  reviews: { count: number; average: number | null } | null;
  activeListings: number;
  onVacation: boolean;
}

const MONTH_SEC = (365.25 / 12) * 86_400;

export function shopStanding(shop: ShopLike, nowSec: number): ShopStanding {
  const opened = shop.create_date;
  const months =
    opened && opened < nowSec
      ? Math.max(1, (nowSec - opened) / MONTH_SEC)
      : null;
  return {
    shopId: String(shop.shop_id),
    name: shop.shop_name,
    url: shop.url,
    sold: shop.transaction_sold_count,
    perMonth:
      months === null ? null : Math.round(shop.transaction_sold_count / months),
    openedOn: opened
      ? new Date(opened * 1000).toISOString().slice(0, 10)
      : null,
    favourites: shop.num_favorers,
    reviews:
      shop.review_count === null || shop.review_count === undefined
        ? null
        : { count: shop.review_count, average: shop.review_average ?? null },
    activeListings: shop.listing_active_count,
    onVacation: shop.is_vacation === true,
  };
}

// Shops by lifetime sales, the most first.
export const rankShops = (shops: ShopStanding[]) =>
  [...shops].sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name));

export interface ListingLike {
  listing_id: number;
  title: string;
  url: string;
  num_favorers: number;
  price: Money;
}

export interface FavouredListing {
  listingId: string;
  title: string;
  url: string;
  favourites: number;
  price: number;
  currency: string;
}

// A shop's listings by favourites, the most first: what Etsy gives in place
// of another shop's sales per listing.
export function favouredListings(
  listings: ListingLike[],
  limit = 20,
): FavouredListing[] {
  return listings
    .map((l) => ({
      listingId: String(l.listing_id),
      title: etsyText(l.title),
      url: l.url,
      favourites: l.num_favorers,
      price: Math.round(amountOf(l.price) * 100) / 100,
      currency: l.price.currency_code,
    }))
    .sort(
      (a, b) => b.favourites - a.favourites || a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

// "$1,234" / "€12.50": an amount as a shop shows it.
export function moneyLabel(amount: number, currency: string | null): string {
  if (!currency) return amount.toLocaleString("en-US");
  try {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : 2,
    });
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}
