"use server";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { MakerProfileData } from "@/lib/pricing/types";

// The maker's saved pricing defaults are a singleton (one local shop).
const PROFILE_ID = "default";

// DATABASE_URL is optional in env.ts (DB-free build/test never throw); assert it
// here at the runtime boundary with an actionable message. Mirrors the workspace
// repository.
function assertDatabaseUrl(): void {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up`.",
    );
  }
}

// Returns the saved profile, or null if none exists / the stored blob no longer
// matches the schema (hardened like workspace restore — a stale row never throws).
export async function getMakerProfile(): Promise<MakerProfileData | null> {
  assertDatabaseUrl();
  const row = await db.makerProfile.findUnique({ where: { id: PROFILE_ID } });
  if (!row) return null;
  const parsed = MakerProfileData.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

// Upsert the singleton. The Zod parse is the trust boundary (Server Functions are
// POST-reachable).
export async function saveMakerProfile(input: unknown): Promise<void> {
  assertDatabaseUrl();
  const data = MakerProfileData.parse(input);
  const json = data as unknown as Prisma.InputJsonValue;
  await db.makerProfile.upsert({
    where: { id: PROFILE_ID },
    create: { id: PROFILE_ID, data: json },
    update: { data: json },
  });
}
