import { Prisma } from "@prisma/client";
import { etsyListingId } from "@/domain/live-listing";
import { ProjectPlan } from "@/domain/plan";
import {
  bestSellers,
  type FavouredListing,
  favouredListings,
  type ListingSales,
  MAX_WATCHED_SHOPS,
  type RankWindow,
  rankShops,
  type ShopStanding,
  shopStanding,
} from "@/domain/shop-ranking";
import { db } from "@/lib/db";
import {
  allPages,
  EtsyError,
  type EtsyReceipt,
  etsyListingUrl,
} from "@/providers/shop/etsy";
import {
  getCurrentMaker,
  getMakerPreferences,
} from "@/server/maker-repository";
import { connectedEtsy, publicEtsy } from "@/server/shop-connection";

// Shops (ROADMAP Phase 20; Luis, 2026-10-27): the maker's best sellers, read
// from their connected shop's receipts, and the other shops they compare
// theirs with, from Etsy's public numbers. Read through the API on request
// and kept in memory for ten minutes (Etsy asks apps to cache); nothing read
// from Etsy is stored.

const FRESH_MS = 10 * 60_000;
// 5,000 orders in a window, 500 of a shop's listings.
const MAX_RECEIPT_PAGES = 50;
const MAX_LISTING_PAGES = 5;
const DAY_SEC = 86_400;

const memo = new Map<string, { at: number; value: unknown }>();

async function remembered<T>(
  key: string,
  fresh: boolean,
  read: () => Promise<T>,
): Promise<T> {
  const kept = memo.get(key);
  if (!fresh && kept && Date.now() - kept.at < FRESH_MS) return kept.value as T;
  const value = await read();
  memo.set(key, { at: Date.now(), value });
  return value;
}

// For tests.
export const forgetShopReads = () => memo.clear();

export interface BestSeller extends ListingSales {
  url: string;
  // The Kiln project whose listing this is, when one names its address.
  project: { id: string; name: string } | null;
}

export interface BestSellersView {
  shopName: string;
  shopUrl: string;
  window: RankWindow;
  from: string;
  rows: BestSeller[];
  // Orders read in the window, and whether every one was (a very busy shop
  // is cut at 5,000).
  orders: number;
  complete: boolean;
  readAt: string;
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

// The connected shop's listings by units sold over the last `window` days;
// null when no shop is connected.
export async function yourBestSellers(
  window: RankWindow,
  options: { fresh?: boolean; now?: Date } = {},
): Promise<BestSellersView | null> {
  const now = options.now ?? new Date();
  const etsy = await connectedEtsy({ now });
  if (!etsy) return null;
  const maker = await getCurrentMaker();
  const nowSec = Math.floor(now.getTime() / 1000);
  const minCreated = nowSec - window * DAY_SEC;
  const read = await remembered(
    `${maker.id}|best|${etsy.shopId}|${window}`,
    options.fresh === true,
    async () => {
      try {
        return await allPages<EtsyReceipt>(
          (page) => etsy.reader.receipts(etsy.shopId, { minCreated, ...page }),
          MAX_RECEIPT_PAGES,
        );
      } catch (error) {
        if (error instanceof EtsyError && error.status === 401) {
          await etsy.revoked();
        }
        throw error;
      }
    },
  );
  const projects = await projectsByListing(maker.id);
  return {
    shopName: etsy.shopName,
    shopUrl: etsy.shopUrl,
    window,
    from: new Date(minCreated * 1000).toISOString().slice(0, 10),
    rows: bestSellers(read.items).map((row) => ({
      ...row,
      url: etsyListingUrl(row.listingId),
      project: projects.get(row.listingId) ?? null,
    })),
    orders: read.items.length,
    complete: read.complete,
    readAt: now.toISOString(),
  };
}

export interface WatchedView {
  standings: ShopStanding[];
  // Shops Etsy did not answer for (closed, renamed, or a failed read).
  failed: { shopId: string; name: string; message: string }[];
}

// The shops the maker compares theirs with, by lifetime sales.
export async function watchedShops(
  options: { fresh?: boolean; now?: Date } = {},
): Promise<WatchedView | null> {
  const etsy = publicEtsy();
  if (!etsy) return null;
  const { watchedShops: watched } = await getMakerPreferences();
  const nowSec = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const standings: ShopStanding[] = [];
  const failed: WatchedView["failed"] = [];
  await Promise.all(
    watched.slice(0, MAX_WATCHED_SHOPS).map(async (w) => {
      try {
        const shop = await remembered(
          `shop|${w.shopId}`,
          options.fresh === true,
          () => etsy.shop(Number(w.shopId)),
        );
        standings.push(shopStanding(shop, nowSec));
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
  const order = new Map(watched.map((w, i) => [w.shopId, i]));
  return {
    standings: rankShops(standings),
    failed: failed.sort(
      (a, b) => (order.get(a.shopId) ?? 0) - (order.get(b.shopId) ?? 0),
    ),
  };
}

// Shops Etsy finds by a name, as standings to pick from.
export async function findShops(
  name: string,
  now = new Date(),
): Promise<ShopStanding[]> {
  const etsy = publicEtsy();
  const wanted = name.trim();
  if (!etsy || !wanted) return [];
  const shops = await etsy.findShops(wanted);
  const nowSec = Math.floor(now.getTime() / 1000);
  return shops.map((s) => shopStanding(s, nowSec));
}

// A shop's active listings by favourites, the most first (Etsy gives another
// shop's sales only as a lifetime total).
export async function shopFavourites(
  shopId: string,
  options: { fresh?: boolean } = {},
): Promise<{ listings: FavouredListing[]; read: number; complete: boolean }> {
  const etsy = publicEtsy();
  if (!etsy) return { listings: [], read: 0, complete: true };
  const { items, complete } = await remembered(
    `listings|${shopId}`,
    options.fresh === true,
    () =>
      allPages(
        (page) => etsy.activeListings(Number(shopId), page),
        MAX_LISTING_PAGES,
      ),
  );
  return { listings: favouredListings(items), read: items.length, complete };
}
