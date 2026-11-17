import { Prisma } from "@prisma/client";
import { etsyListingId } from "@/domain/live-listing";
import { ProjectPlan } from "@/domain/plan";
import {
  bestSellers,
  type FavouredListing,
  favouredListings,
  type ListingNow,
  type ListingSales,
  listingNow,
  listingPhoto,
  MAX_WATCHED_SHOPS,
  type RankBy,
  type RankWindow,
  rankBestSellers,
  rankShops,
  type SalesTotals,
  type ShopRankBy,
  type ShopStanding,
  salesTotals,
  setAside,
  shopStanding,
} from "@/domain/shop-ranking";
import { db } from "@/lib/db";
import {
  allPages,
  BATCH_LIMIT,
  EtsyError,
  type EtsyListingDetail,
  type EtsyReader,
  type EtsyReceipt,
  etsyListingUrl,
} from "@/providers/shop/etsy";
import type { MakerRef } from "@/server/maker-repository";
import { getMakerPreferences } from "@/server/maker-repository";
import {
  connectedEtsy,
  publicEtsy,
  shopConnection,
} from "@/server/shop-connection";

// Shops (Luis, 2026-10-27): the maker's best sellers, read from their connected
// shop's receipts, and the other shops they compare theirs with, from Etsy's
// public numbers. Read through the API on request and kept in memory for ten
// minutes; Etsy's API terms (2026-08-18) allow showing listings at most six
// hours old and storing nothing longer than the service needs, so nothing read
// from Etsy is stored.

const FRESH_MS = 10 * 60_000;
// 5,000 orders in a window, 500 of a shop's listings, the details (photo,
// state) of the 300 best sellers.
const MAX_RECEIPT_PAGES = 50;
const MAX_LISTING_PAGES = 5;
const MAX_DETAIL_BATCHES = 3;
const DAY_SEC = 86_400;

const memo = new Map<string, { at: number; value: unknown }>();

// A read kept for ten minutes, with when it was read.
async function rememberedAt<T>(
  key: string,
  fresh: boolean,
  read: () => Promise<T>,
): Promise<{ value: T; at: number }> {
  const kept = memo.get(key);
  if (!fresh && kept && Date.now() - kept.at < FRESH_MS) {
    return { value: kept.value as T, at: kept.at };
  }
  const value = await read();
  const at = Date.now();
  memo.set(key, { at, value });
  return { value, at };
}

const remembered = async <T>(
  key: string,
  fresh: boolean,
  read: () => Promise<T>,
): Promise<T> => (await rememberedAt(key, fresh, read)).value;

// For tests.
export const forgetShopReads = () => memo.clear();

export interface BestSeller extends ListingSales {
  url: string;
  // The Kiln project whose listing this is, when one names its address.
  project: { id: string; name: string } | null;
  photo: string | null;
  now: ListingNow;
  // The maker left it out of the ranking.
  leftOut: boolean;
}

export interface BestSellersView {
  shopName: string;
  shopUrl: string;
  window: RankWindow;
  by: RankBy;
  from: string;
  // The listings to refresh, ranked; and the ones set aside (made for one
  // buyer, deleted, or left out by the maker), by orders.
  rows: BestSeller[];
  setAside: BestSeller[];
  totals: SalesTotals;
  // Whether every order in the window was read (a very busy shop is cut at
  // 5,000).
  complete: boolean;
  // Why photos and states are missing, when Etsy did not give them.
  detailsProblem: string | null;
  readAt: string;
}

// Listings by id, in batches, with their photos and states.
async function listingDetails(
  reader: EtsyReader,
  ids: string[],
): Promise<Map<number, EtsyListingDetail>> {
  const found = new Map<number, EtsyListingDetail>();
  const wanted = ids.map(Number).slice(0, BATCH_LIMIT * MAX_DETAIL_BATCHES);
  for (let i = 0; i < wanted.length; i += BATCH_LIMIT) {
    for (const d of await reader.listings(wanted.slice(i, i + BATCH_LIMIT))) {
      found.set(d.listing_id, d);
    }
  }
  return found;
}

// Which Kiln project each Etsy listing belongs to, by the listing address a
// project keeps for its sale destination.
async function projectsByListing(
  makerId: string,
): Promise<Map<string, { id: string; name: string }>> {
  const rows = await db.project.findMany({
    where: { makerId, plan: { not: Prisma.DbNull } },
    select: { id: true, name: true, plan: true },
    orderBy: { updatedAt: "desc" },
  });
  const found = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    const plan = ProjectPlan.safeParse(row.plan);
    if (!plan.success) continue;
    for (const d of plan.data.destinations) {
      const id = d.listingUrl ? etsyListingId(d.listingUrl) : null;
      if (id && !found.has(id)) found.set(id, { id: row.id, name: row.name });
    }
  }
  return found;
}

// The connected shop's listings over the last `window` days, ranked `by`
// orders, units or revenue; null when no shop is connected.
export async function yourBestSellers(
  maker: MakerRef,
  window: RankWindow,
  options: { by?: RankBy; fresh?: boolean; now?: Date } = {},
): Promise<BestSellersView | null> {
  const now = options.now ?? new Date();
  const by = options.by ?? "orders";
  const fresh = options.fresh === true;
  const etsy = await connectedEtsy(maker, { now });
  if (!etsy) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  const minCreated = nowSec - window * DAY_SEC;
  const revokedOn401 = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof EtsyError && error.status === 401) {
        await etsy.revoked();
      }
      throw error;
    }
  };
  const { value: read, at } = await rememberedAt(
    `${maker.id}|best|${etsy.shopId}|${window}`,
    fresh,
    () =>
      revokedOn401(() =>
        allPages<EtsyReceipt>(
          (page) => etsy.reader.receipts(etsy.shopId, { minCreated, ...page }),
          MAX_RECEIPT_PAGES,
        ),
      ),
  );
  const sold = bestSellers(read.items);
  let details: Map<number, EtsyListingDetail> | null = null;
  let detailsProblem: string | null = null;
  try {
    details = await remembered(
      `${maker.id}|best-details|${etsy.shopId}|${window}`,
      fresh,
      () =>
        revokedOn401(() =>
          listingDetails(
            etsy.reader,
            rankBestSellers(sold, "orders").map((r) => r.listingId),
          ),
        ),
    );
  } catch (error) {
    if (error instanceof EtsyError && error.status === 401) throw error;
    detailsProblem = `Photos and listing states were not read: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  const [projects, { leftOutListings }] = await Promise.all([
    projectsByListing(maker.id),
    getMakerPreferences(maker),
  ]);
  const leftOut = new Set(leftOutListings);
  const rows: BestSeller[] = sold.map((row) => {
    const detail = details?.get(Number(row.listingId));
    return {
      ...row,
      url: etsyListingUrl(row.listingId),
      project: projects.get(row.listingId) ?? null,
      photo: listingPhoto(detail),
      now: listingNow(detail, details !== null),
      leftOut: leftOut.has(row.listingId),
    };
  });
  return {
    shopName: etsy.shopName,
    shopUrl: etsy.shopUrl,
    window,
    by,
    from: new Date(minCreated * 1000).toISOString().slice(0, 10),
    rows: rankBestSellers(
      rows.filter((r) => !setAside(r.now, r.leftOut)),
      by,
    ),
    setAside: rankBestSellers(
      rows.filter((r) => setAside(r.now, r.leftOut)),
      "orders",
    ),
    totals: salesTotals(read.items),
    complete: read.complete,
    detailsProblem,
    readAt: new Date(at).toISOString(),
  };
}

export interface WatchedView {
  // The compared shops ranked `by`, the maker's own among them.
  standings: ShopStanding[];
  by: ShopRankBy;
  yourShopId: string | null;
  // Shops Etsy did not answer for (closed, renamed, or a failed read).
  failed: { shopId: string; name: string; message: string }[];
}

// The shops the maker compares theirs with, with theirs beside them, by the
// past year (reviews) or by lifetime sales.
export async function watchedShops(
  maker: MakerRef,
  options: { by?: ShopRankBy; fresh?: boolean } = {},
): Promise<WatchedView | null> {
  const etsy = publicEtsy();
  if (!etsy) return null;
  const by = options.by ?? "recent";
  const fresh = options.fresh === true;
  const [{ watchedShops: watched }, yours] = await Promise.all([
    getMakerPreferences(maker),
    shopConnection(maker),
  ]);
  const standings: ShopStanding[] = [];
  const failed: WatchedView["failed"] = [];
  const read = (shopId: string) =>
    remembered(`shop|${shopId}`, fresh, () => etsy.shop(Number(shopId)));
  await Promise.all(
    watched.slice(0, MAX_WATCHED_SHOPS).map(async (w) => {
      try {
        standings.push(shopStanding(await read(w.shopId)));
      } catch (error) {
        failed.push({
          shopId: w.shopId,
          name: w.name,
          message:
            error instanceof EtsyError && error.status === 404
              ? "Etsy has no shop by this id any more."
              : `Not read: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),
  );
  let yourShopId: string | null = null;
  if (yours && !standings.some((s) => s.shopId === yours.shopId)) {
    try {
      standings.push(shopStanding(await read(yours.shopId)));
      yourShopId = yours.shopId;
    } catch {
      // The comparison stands without the maker's own row.
    }
  } else if (yours) {
    yourShopId = yours.shopId;
  }
  const order = new Map(watched.map((w, i) => [w.shopId, i]));
  return {
    standings: rankShops(standings, by),
    by,
    yourShopId,
    failed: failed.sort(
      (a, b) => (order.get(a.shopId) ?? 0) - (order.get(b.shopId) ?? 0),
    ),
  };
}

// Shops Etsy finds by a name, as standings to pick from.
export async function findShops(name: string): Promise<ShopStanding[]> {
  const etsy = publicEtsy();
  const wanted = name.trim();
  if (!etsy || !wanted) return [];
  return (await etsy.findShops(wanted)).map(shopStanding);
}

// A shop's active listings by favourites, the most first (Etsy gives another
// shop's sales only as a lifetime total), each with its first photo.
export async function shopFavourites(
  shopId: string,
  options: { fresh?: boolean } = {},
): Promise<{ listings: FavouredListing[]; read: number; complete: boolean }> {
  const etsy = publicEtsy();
  if (!etsy) return { listings: [], read: 0, complete: true };
  const fresh = options.fresh === true;
  const { items, complete } = await remembered(
    `listings|${shopId}`,
    fresh,
    () =>
      allPages(
        (page) => etsy.activeListings(Number(shopId), page),
        MAX_LISTING_PAGES,
      ),
  );
  const top = favouredListings(items);
  const photos = await remembered(`photos|${shopId}`, fresh, () =>
    listingDetails(
      etsy,
      top.map((l) => l.listingId),
    ).catch(() => new Map<number, EtsyListingDetail>()),
  );
  return {
    listings: top.map((l) => ({
      ...l,
      photo: listingPhoto(photos.get(Number(l.listingId))),
    })),
    read: items.length,
    complete,
  };
}
