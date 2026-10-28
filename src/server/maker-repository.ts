import type { Prisma } from "@prisma/client";
import { BrandKit } from "@/domain/brand";
import { modelPriced } from "@/domain/generation-cost";
import { type HeroSetting, heroKey } from "@/domain/hero-setting";
import {
  type MakerPreferences,
  readPreferences,
} from "@/domain/maker-preferences";
import { SearchColumns } from "@/domain/market-brief";
import {
  assertModel,
  DEFAULT_MAKER_MODELS,
  MakerModels,
  ModelRefused,
  makerModels,
} from "@/domain/model-defaults";
import {
  ListingId,
  MAX_LEFT_OUT,
  MAX_WATCHED_SHOPS,
  WatchedShop,
} from "@/domain/shop-ranking";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import { env } from "@/lib/env";

export interface CurrentMaker {
  id: string;
  slug: string;
  name: string;
}

// Per-process cache of slug -> maker. The maker row is created once and never
// renamed by its slug, so the cache only saves one upsert per request.
const makers = new Map<string, CurrentMaker>();

// The maker this instance works for (env KILN_MAKER, default "default"). The
// one place the "current maker" is resolved, so accounts can replace it later.
// Upsert on the unique slug: concurrent first requests cannot create two makers.
export async function getCurrentMaker(): Promise<CurrentMaker> {
  assertDatabaseUrl();
  const slug = env.KILN_MAKER;
  const cached = makers.get(slug);
  if (cached) return cached;
  const maker = await db.maker.upsert({
    where: { slug },
    create: { slug, name: slug === "default" ? "My studio" : slug },
    update: {},
    select: { id: true, slug: true, name: true },
  });
  makers.set(slug, maker);
  return maker;
}

// The maker's brand kit, or null when none was imported or the stored blob no
// longer matches the schema (hardened on read: a stale row never throws).
export async function getMakerBrand(): Promise<BrandKit | null> {
  const maker = await getCurrentMaker();
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { brand: true },
  });
  const parsed = BrandKit.safeParse(row?.brand);
  return row?.brand && parsed.success ? parsed.data : null;
}

export async function saveMakerBrand(brand: BrandKit): Promise<void> {
  const maker = await getCurrentMaker();
  await db.maker.update({
    where: { id: maker.id },
    data: { brand: brand as unknown as Prisma.InputJsonValue },
  });
}

// The maker's default model per kind (Settings → Models), read leniently: a
// kind never saved, or saved on a model Kiln no longer offers, reads as Kiln's
// default. Without a database (tests, demos) Kiln's defaults.
export async function getMakerModels(): Promise<MakerModels> {
  if (!hasDatabase()) return DEFAULT_MAKER_MODELS;
  const maker = await getCurrentMaker();
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { models: true },
  });
  return makerModels(row?.models);
}

// The maker's remembered choices (hero-setting.ts); none without a database.
export async function getMakerPreferences(): Promise<MakerPreferences> {
  if (!hasDatabase()) {
    return {
      heroSetting: {},
      searchColumns: {},
      watchedShops: [],
      leftOutListings: [],
    };
  }
  const maker = await getCurrentMaker();
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { preferences: true },
  });
  return readPreferences(row?.preferences);
}

// Change one kind of remembered choice under the maker's row lock, so two
// writes at once both land; every other key stays as it is. `update` returns
// null when nothing changes.
async function updatePreferences(
  update: (
    kept: MakerPreferences,
  ) => Partial<Record<keyof MakerPreferences, unknown>> | null,
): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Maker" WHERE "id" = ${maker.id} FOR UPDATE`;
    const row = await tx.maker.findUniqueOrThrow({
      where: { id: maker.id },
      select: { preferences: true },
    });
    const changed = update(readPreferences(row.preferences));
    if (!changed) return;
    const raw =
      row.preferences && typeof row.preferences === "object"
        ? (row.preferences as Record<string, unknown>)
        : {};
    await tx.maker.update({
      where: { id: maker.id },
      data: { preferences: { ...raw, ...changed } as Prisma.InputJsonValue },
    });
  });
}

// Remember the hero's setting for a destination and a product family.
export async function rememberHeroSetting(
  destinationId: string,
  family: string,
  setting: HeroSetting,
): Promise<void> {
  const key = heroKey(destinationId, family);
  await updatePreferences((kept) =>
    kept.heroSetting[key] === setting
      ? null
      : { heroSetting: { ...kept.heroSetting, [key]: setting } },
  );
}

// Remember which header holds each value of a source's search table, so its
// next export is read without asking.
export async function rememberSearchColumns(
  source: string,
  columns: SearchColumns,
): Promise<void> {
  const name = source.trim();
  const mapping = SearchColumns.parse(columns);
  if (!name) return;
  await updatePreferences((kept) =>
    JSON.stringify(kept.searchColumns[name]) === JSON.stringify(mapping)
      ? null
      : { searchColumns: { ...kept.searchColumns, [name]: mapping } },
  );
}

// Add a shop to the ones the maker compares theirs with (Shops), or take
// one off; false when it was already there (or not there), or the list is
// full.
export async function watchShop(shop: WatchedShop): Promise<boolean> {
  const wanted = WatchedShop.parse(shop);
  let added = false;
  await updatePreferences((kept) => {
    if (
      kept.watchedShops.some((s) => s.shopId === wanted.shopId) ||
      kept.watchedShops.length >= MAX_WATCHED_SHOPS
    ) {
      return null;
    }
    added = true;
    return { watchedShops: [...kept.watchedShops, wanted] };
  });
  return added;
}

export async function unwatchShop(shopId: string): Promise<boolean> {
  let removed = false;
  await updatePreferences((kept) => {
    const rest = kept.watchedShops.filter((s) => s.shopId !== shopId);
    if (rest.length === kept.watchedShops.length) return null;
    removed = true;
    return { watchedShops: rest };
  });
  return removed;
}

// Leave a listing of the maker's shop out of their best sellers, or put it
// back; false when nothing changed.
export async function leaveOutListing(
  listingId: string,
  out: boolean,
): Promise<boolean> {
  const id = ListingId.parse(listingId);
  let changed = false;
  await updatePreferences((kept) => {
    const has = kept.leftOutListings.includes(id);
    if (has === out || (out && kept.leftOutListings.length >= MAX_LEFT_OUT)) {
      return null;
    }
    changed = true;
    return {
      leftOutListings: out
        ? [...kept.leftOutListings, id]
        : kept.leftOutListings.filter((l) => l !== id),
    };
  });
  return changed;
}

// Save the defaults: each kind must be a model Kiln offers for it, with a
// pinned price (so anything it starts can run under the cap).
export async function saveMakerModels(input: MakerModels): Promise<void> {
  const models = MakerModels.parse(input);
  for (const kind of ["image", "video", "text"] as const) {
    const entry = assertModel(models[kind], kind);
    if (!modelPriced(models[kind], kind)) {
      throw new ModelRefused(`${entry.label} has no pinned price.`);
    }
  }
  const maker = await getCurrentMaker();
  await db.maker.update({
    where: { id: maker.id },
    data: { models: models as unknown as Prisma.InputJsonValue },
  });
}
