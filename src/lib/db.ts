import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

// Prisma 7 connects through a driver adapter (no Rust engine). One global-cached
// client so dev hot-reload doesn't exhaust Postgres connections. Server-only by
// convention — reached only via the @/server repositories, which Server Actions
// call (mirrors how @/providers is reached only through Server Actions).
// DATABASE_URL is asserted by assertDatabaseUrl before any query; "" here defers
// to that error.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL ?? "" });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// DATABASE_URL is optional in env.ts (so DB-free build/test never throw). Every
// repository calls this first: the runtime assertion point, with an actionable
// message.
export function assertDatabaseUrl(): void {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up`.",
    );
  }
}
