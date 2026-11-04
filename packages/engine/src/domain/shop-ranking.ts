import { z } from "zod";

// Rankings read from a shop's API (Luis, 2026-10-27: "el ranking de Etsy por
// API oficial"). The maker's own shop: units sold per listing, from its
// receipts (exact). Another shop: Etsy gives its lifetime sales, its reviews
// and each listing's favourites, never what one listing sold, so its listings
// rank by favourites and say so. Pure: the server reads the API, these shape
// what it read.

export const RANK_WINDOWS = [30, 90, 365] as const;
export const RankWindow = z.coerce
  .number()
  .pipe(z.union(RANK_WINDOWS.map((d) => z.literal(d))))
  .catch(90);
export type RankWindow = (typeof RANK_WINDOWS)[number];

export const MAX_WATCHED_SHOPS = 12;
// Listings of the maker's shop they left out of their best sellers.
export const MAX_LEFT_OUT = 500;
export const ListingId = z.string().regex(/^\d+$/).max(20);

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

// How the maker's best sellers are ranked. Orders count buyers, so one bulk
// order does not lift a listing over one many people buy (the default);
// units and revenue are a click away.
export const RANK_BY = ["orders", "units", "revenue"] as const;
export const RankBy = z.enum(RANK_BY).catch("orders");
export type RankBy = (typeof RANK_BY)[number];

export function rankBestSellers<T extends ListingSales>(
  rows: T[],
  by: RankBy,
): T[] {
  const key: Record<RankBy, (keyof ListingSales)[]> = {
    orders: ["orders", "units", "revenue"],
    units: ["units", "orders", "revenue"],
    revenue: ["revenue", "orders", "units"],
  };
  return [...rows].sort((a, b) => {
    for (const k of key[by]) {
      const d = (b[k] as number) - (a[k] as number);
      if (d !== 0) return d;
    }
    return a.title.localeCompare(b.title);
  });
}

export interface SalesTotals {
  orders: number;
  units: number;
  revenue: number;
  currency: string | null;
  listings: number;
}

// A window's sales in all: the orders that count as sales, their units and
// revenue, and how many listings sold.
export function salesTotals(receipts: ReceiptLike[]): SalesTotals {
  const totals: SalesTotals = {
    orders: 0,
    units: 0,
    revenue: 0,
    currency: null,
    listings: 0,
  };
  const listings = new Set<number>();
  let currency: string | null | undefined;
  for (const receipt of receipts) {
    if (!countsAsSale(receipt.status)) continue;
    totals.orders += 1;
    for (const line of receipt.transactions) {
      if (line.quantity <= 0) continue;
      totals.units += line.quantity;
      totals.revenue += amountOf(line.price) * line.quantity;
      if (line.listing_id !== null) listings.add(line.listing_id);
      const code = line.price.currency_code || null;
      currency = currency === undefined || currency === code ? code : null;
    }
  }
  totals.revenue = Math.round(totals.revenue * 100) / 100;
  totals.currency = currency ?? null;
  totals.listings = listings.size;
  return totals;
}

// What a sold listing is on Etsy now. A private listing was made for one
// buyer (a custom order, an upgrade); one Etsy no longer answers for was
// deleted. "unknown" when the listings could not be read.
export type ListingNow =
  | "live"
  | "sold-out"
  | "inactive"
  | "one-off"
  | "gone"
  | "unknown";

export interface ListingDetailLike {
  listing_id: number;
  state: string;
  is_private?: boolean;
  images?:
    | {
        rank?: number;
        url_75x75?: string;
        url_170x135?: string;
        url_570xN?: string;
      }[]
    | null;
}

export function listingNow(
  detail: ListingDetailLike | undefined,
  read: boolean,
): ListingNow {
  if (!read) return "unknown";
  if (!detail) return "gone";
  if (detail.is_private) return "one-off";
  const state = detail.state.trim().toLowerCase();
  if (state === "active") return "live";
  if (state === "sold_out") return "sold-out";
  return "inactive";
}

// One-offs and deleted listings are not products to refresh: set aside from
// the ranking, with the listings the maker left out.
export const setAside = (now: ListingNow, leftOut: boolean) =>
  leftOut || now === "one-off" || now === "gone";

// A listing's first photo, small enough for a list.
export function listingPhoto(
  detail: ListingDetailLike | undefined,
): string | null {
  const first = [...(detail?.images ?? [])].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99),
  )[0];
  return first?.url_170x135 ?? first?.url_570xN ?? first?.url_75x75 ?? null;
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
  icon_url_fullxfull?: string | null;
}

export interface ShopStanding {
  shopId: string;
  name: string;
  url: string;
  icon: string | null;
  // Lifetime sales, and when the shop opened (a lifetime average would hide
  // its pace now, so none is made).
  sold: number;
  openedOn: string | null;
  favourites: number;
  // Reviews of the past year (Etsy's definition): the one recent number
  // Etsy gives about another shop.
  reviews: { count: number; average: number | null } | null;
  activeListings: number;
  onVacation: boolean;
}

export function shopStanding(shop: ShopLike): ShopStanding {
  const opened = shop.create_date;
  return {
    shopId: String(shop.shop_id),
    name: shop.shop_name,
    url: shop.url,
    icon: shop.icon_url_fullxfull ?? null,
    sold: shop.transaction_sold_count,
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

// Shops by the past year (reviews, the most first; a shop without any
// last) or by lifetime sales.
export const SHOP_RANK_BY = ["recent", "lifetime"] as const;
export const ShopRankBy = z.enum(SHOP_RANK_BY).catch("recent");
export type ShopRankBy = (typeof SHOP_RANK_BY)[number];

export const rankShops = (shops: ShopStanding[], by: ShopRankBy = "recent") =>
  [...shops].sort(
    (a, b) =>
      (by === "recent"
        ? (b.reviews?.count ?? -1) - (a.reviews?.count ?? -1)
        : 0) ||
      b.sold - a.sold ||
      a.name.localeCompare(b.name),
  );

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
  photo: string | null;
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
      photo: null,
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
