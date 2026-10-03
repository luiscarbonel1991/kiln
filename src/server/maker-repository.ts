import type { Prisma } from "@prisma/client";
import { assertDatabaseUrl, db } from "@/lib/db";
import { env } from "@/lib/env";
import { MakerProfileData } from "@/lib/pricing/types";

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

// The laser cost calculator's saved defaults, or null if none exist / the stored
// blob no longer matches the schema (hardened like project restore — a stale row
// never throws).
export async function getMakerPricing(): Promise<MakerProfileData | null> {
  const maker = await getCurrentMaker();
  const row = await db.maker.findUnique({
    where: { id: maker.id },
    select: { pricing: true },
  });
  const parsed = MakerProfileData.safeParse(row?.pricing);
  return parsed.success ? parsed.data : null;
}

export async function saveMakerPricing(data: MakerProfileData): Promise<void> {
  const maker = await getCurrentMaker();
  await db.maker.update({
    where: { id: maker.id },
    data: { pricing: data as unknown as Prisma.InputJsonValue },
  });
}
