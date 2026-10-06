import type { Prisma } from "@prisma/client";
import { BrandKit } from "@/domain/brand";
import { modelPriced } from "@/domain/generation-cost";
import {
  assertModel,
  DEFAULT_MAKER_MODELS,
  MakerModels,
  ModelRefused,
  makerModels,
} from "@/domain/model-defaults";
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
