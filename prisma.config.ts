import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the connection URL out of schema.prisma. The CLI (migrate /
// studio) reads it here; the runtime PrismaClient connects via the
// @prisma/adapter-pg driver adapter (see src/lib/db.ts). dotenv loads .env for
// the CLI (Next.js loads it for the app at runtime). The shadow database is only
// used by `prisma migrate dev` / `migrate diff --from-migrations`; it is
// optional so deploy-only environments do not need it.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
