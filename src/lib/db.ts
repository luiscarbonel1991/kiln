import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

// Prisma 7 connects through a driver adapter (no Rust engine). One global-cached
// client so dev hot-reload doesn't exhaust Postgres connections. Server-only by
// convention — reached only via @/server/workspace-repository behind "use server"
// (mirrors how @/providers is reached only through Server Actions). DATABASE_URL
// is asserted by the repository before any query; "" here defers to that error.
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
