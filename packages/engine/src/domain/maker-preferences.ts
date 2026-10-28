import { z } from "zod";
import { HeroSetting } from "@/domain/hero-setting";
import { SearchColumns } from "@/domain/market-brief";
import {
  ListingId,
  MAX_LEFT_OUT,
  MAX_WATCHED_SHOPS,
  WatchedShop,
} from "@/domain/shop-ranking";

// What a maker's choices are kept as (`Maker.preferences`), read leniently: a
// value a later version drops reads as unset, and the rest still reads.

const lenientRecord = <T extends z.ZodType>(value: T) =>
  z
    .record(z.string(), z.unknown())
    .catch({})
    .default({})
    .transform(
      (all) =>
        Object.fromEntries(
          Object.entries(all).flatMap(([key, raw]) => {
            const parsed = value.safeParse(raw);
            return parsed.success ? [[key, parsed.data]] : [];
          }),
        ) as Record<string, z.infer<T>>,
    );

// A list read item by item: one unreadable entry drops, the rest stay.
const lenientList = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((all) =>
      all
        .flatMap((raw) => {
          const parsed = item.safeParse(raw);
          return parsed.success ? [parsed.data as z.infer<T>] : [];
        })
        .slice(0, max),
    );

export const MakerPreferences = z.object({
  // The hero's setting per destination and product family (heroKey).
  heroSetting: lenientRecord(HeroSetting),
  // Which header holds each value of a search table, per source ("EverBee").
  searchColumns: lenientRecord(SearchColumns),
  // Other shops the maker compares theirs with (Shops), in the order added.
  watchedShops: lenientList(WatchedShop, MAX_WATCHED_SHOPS),
  // Listings of the maker's shop left out of their best sellers (add-ons,
  // samples: anything that is not a product to refresh).
  leftOutListings: lenientList(ListingId, MAX_LEFT_OUT),
});
export type MakerPreferences = z.infer<typeof MakerPreferences>;

export function readPreferences(raw: unknown): MakerPreferences {
  const parsed = MakerPreferences.safeParse(raw ?? {});
  return parsed.success
    ? parsed.data
    : {
        heroSetting: {},
        searchColumns: {},
        watchedShops: [],
        leftOutListings: [],
      };
}
