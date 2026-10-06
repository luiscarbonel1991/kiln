#!/usr/bin/env node
// Create and migrate the mock runs' own database (pnpm db:mock:setup). A mock
// process (KILN_PROVIDERS=mock, pnpm dev:mock) connects to
// KILN_MOCK_DATABASE_URL, else DATABASE_URL's database with "_mock" appended —
// the same rule as src/lib/database-url.ts — so it never touches live data.
import { execFileSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

const live = process.env.DATABASE_URL;
if (!live) {
  console.error("DATABASE_URL is not set (copy .env.example to .env).");
  process.exit(1);
}
const mockUrl = new URL(process.env.KILN_MOCK_DATABASE_URL ?? live);
if (!process.env.KILN_MOCK_DATABASE_URL) {
  mockUrl.pathname = `${mockUrl.pathname}_mock`;
}
if (mockUrl.toString() === new URL(live).toString()) {
  console.error("The mock database must differ from DATABASE_URL.");
  process.exit(1);
}
const name = mockUrl.pathname.replace(/^\//, "");

const admin = new pg.Client({ connectionString: live });
await admin.connect();
const { rowCount } = await admin.query(
  "SELECT 1 FROM pg_database WHERE datname = $1",
  [name],
);
if (rowCount === 0) {
  await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  console.log(`created database ${name}`);
}
await admin.end();

execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: mockUrl.toString() },
});
console.log(`mock database ready: ${name}`);
