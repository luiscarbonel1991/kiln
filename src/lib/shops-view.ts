import type {
  ListingNow,
  RankBy,
  RankWindow,
  ShopRankBy,
} from "@/domain/shop-ranking";

// What Shops is showing, as its address keeps it: the window and order of
// the maker's best sellers, and the order of the shops they compare.
export interface ShopsQuery {
  window: RankWindow;
  by: RankBy;
  shops: ShopRankBy;
}

const DEFAULTS: ShopsQuery = { window: 90, by: "orders", shops: "recent" };

// The Shops address for a query changed by `change`; defaults are left out,
// and `fresh` reads Etsy again instead of the last ten minutes' read.
export function shopsHref(
  query: ShopsQuery,
  change: Partial<ShopsQuery> & { fresh?: boolean } = {},
): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.window !== DEFAULTS.window)
    params.set("window", String(next.window));
  if (next.by !== DEFAULTS.by) params.set("by", next.by);
  if (next.shops !== DEFAULTS.shops) params.set("shops", next.shops);
  if (change.fresh) params.set("fresh", "1");
  const search = params.toString();
  return search ? `/shops?${search}` : "/shops";
}

export const windowLabel = (days: RankWindow) =>
  days === 365 ? "Year" : `${days} days`;

export const windowSince = (days: RankWindow) =>
  days === 365 ? "the last year" : `the last ${days} days`;

export const RANK_BY_LABEL: Record<RankBy, string> = {
  orders: "Orders",
  units: "Units",
  revenue: "Revenue",
};

export const SHOP_RANK_LABEL: Record<ShopRankBy, string> = {
  recent: "Past year",
  lifetime: "Lifetime",
};

// A sold listing's state, as a short note beside it; nothing for a live one.
export const LISTING_NOW_LABEL: Record<ListingNow, string | null> = {
  live: null,
  "sold-out": "Sold out",
  inactive: "Not live",
  "one-off": "Made for one buyer",
  gone: "No longer on Etsy",
  unknown: null,
};
