import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { databaseUrlFor } from "@/lib/database-url";
import { env } from "@/lib/env";
import { providerMode } from "@/providers/mode";

// Prisma 7 connects through a driver adapter (no Rust engine). One client per
// process, cached on globalThis in every environment: dev hot reload would
// otherwise exhaust connections, and under `next start` separate module graphs
// (pages, route handlers, instrumentation) would each open their own pool. Server-only by
// convention — reached only via the @/server repositories, which Server Actions
// call (mirrors how @/providers is reached only through Server Actions).
// The URL is asserted by assertDatabaseUrl before any query; "" here defers to
// that error. A mock process connects to its own database (database-url.ts).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const DATABASE_URL = databaseUrlFor({
  mode: providerMode(),
  databaseUrl: env.DATABASE_URL,
  mockDatabaseUrl: env.KILN_MOCK_DATABASE_URL,
});

// Whether this process has a database (DB-free builds and tests do not).
export function hasDatabase(): boolean {
  return Boolean(DATABASE_URL);
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: DATABASE_URL ?? "" });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = db;

// DATABASE_URL is optional in env.ts (so DB-free build/test never throw). Every
// repository calls this first: the runtime assertion point, with an actionable
// message.
export function assertDatabaseUrl(): void {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up`.",
    );
  }
}
