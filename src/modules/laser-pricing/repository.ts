import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { MakerProfileData } from "@/modules/laser-pricing/types";
import type { MakerRef } from "@/server/maker-repository";

const MODULE = "laser-pricing";

// The cost calculator's saved defaults for the current maker, in the module's
// own settings row. null when none exist or the stored blob no longer matches
// the schema (hardened like project restore: a stale row never throws).
export async function getMakerPricing(
  maker: MakerRef,
): Promise<MakerProfileData | null> {
  const row = await db.moduleSettings.findUnique({
    where: { makerId_module: { makerId: maker.id, module: MODULE } },
    select: { settings: true },
  });
  const parsed = MakerProfileData.safeParse(row?.settings);
  return parsed.success ? parsed.data : null;
}

export async function saveMakerPricing(
  maker: MakerRef,
  data: MakerProfileData,
): Promise<void> {
  const settings = data as unknown as Prisma.InputJsonValue;
  await db.moduleSettings.upsert({
    where: { makerId_module: { makerId: maker.id, module: MODULE } },
    create: { makerId: maker.id, module: MODULE, settings },
    update: { settings },
  });
}
