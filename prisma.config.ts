import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the connection URL out of schema.prisma. The CLI (db push /
// migrate / studio) reads it here; the runtime PrismaClient connects via the
// @prisma/adapter-pg driver adapter (see src/lib/db.ts). dotenv loads .env for
// the CLI (Next.js loads it for the app at runtime).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
