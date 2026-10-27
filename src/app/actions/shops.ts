"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  type FavouredListing,
  MAX_WATCHED_SHOPS,
  type ShopStanding,
  WatchedShop,
} from "@/domain/shop-ranking";
import { EtsyError } from "@/providers/shop/etsy";
import {
  getMakerPreferences,
  unwatchShop,
  watchShop,
} from "@/server/maker-repository";
import { disconnectShop } from "@/server/shop-connection";
import { findShops, shopFavourites } from "@/server/shop-ranking";

// Shops and Settings → Shops. Zod is the trust boundary; Etsy's refusals come
// back in its words.

const said = (error: unknown) =>
  error instanceof EtsyError
    ? `Etsy said: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

export async function disconnectShopAction(): Promise<{ error?: string }> {
  const gone = await disconnectShop();
  refresh();
  return gone ? {} : { error: "No shop was connected." };
}

export async function findShopsAction(
  input: unknown,
): Promise<{ shops: ShopStanding[] } | { error: string }> {
  const parsed = z.string().trim().min(2).max(80).safeParse(input);
  if (!parsed.success)
    return { error: "Type at least two letters of the shop's name." };
  try {
    return { shops: await findShops(parsed.data) };
  } catch (error) {
    return { error: said(error) };
  }
}

export async function watchShopAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = WatchedShop.safeParse(input);
  if (!parsed.success) return { error: "Which shop?" };
  const { watchedShops } = await getMakerPreferences();
  if (watchedShops.some((s) => s.shopId === parsed.data.shopId)) {
    return { error: `${parsed.data.name} is already on the list.` };
  }
  if (watchedShops.length >= MAX_WATCHED_SHOPS) {
    return {
      error: `At most ${MAX_WATCHED_SHOPS} shops: take one off first.`,
    };
  }
  await watchShop(parsed.data);
  refresh();
  return {};
}

export async function unwatchShopAction(
  input: unknown,
): Promise<{ error?: string }> {
  const parsed = WatchedShop.shape.shopId.safeParse(input);
  if (!parsed.success) return { error: "Which shop?" };
  await unwatchShop(parsed.data);
  refresh();
  return {};
}

export async function shopFavouritesAction(
  input: unknown,
): Promise<
  | { listings: FavouredListing[]; read: number; complete: boolean }
  | { error: string }
> {
  const parsed = WatchedShop.shape.shopId.safeParse(input);
  if (!parsed.success) return { error: "Which shop?" };
  try {
    return await shopFavourites(parsed.data);
  } catch (error) {
    return { error: said(error) };
  }
}
