#!/usr/bin/env node
// The public page as static files, for a host with no server (GitHub Pages):
//   pnpm site:export --base /kiln --start https://github.com/<owner>/kiln
// `--base` is the path the site is served under ("" at a domain's root) and
// `--start` where its "Get started" leads (default: this repository), so the
// page never points at an app that is not there. It builds Kiln once into
// .next-site with that base, then copies what the page needs into site/: its
// prerendered HTML, its scripts, styles and fonts, and the sample kit's files.
// It ends by checking that every file the page names is there.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const base = (arg("base") ?? "").replace(/\/+$/, "");
if (base && !/^\/[A-Za-z0-9._~/-]+$/.test(base)) {
  console.error(`--base must be a path like /kiln, not "${base}".`);
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const start =
  arg("start") ??
  String(pkg.repository?.url ?? "")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
if (!/^https:\/\//.test(start)) {
  console.error(
    "--start must be an https address (where a visitor gets Kiln).",
  );
  process.exit(2);
}

const dist = join(root, ".next-site");
const out = join(root, "site");

// `next build` rewrites tsconfig.json to name its build folder; the export
// leaves the project as it found it.
const tsconfig = join(root, "tsconfig.json");
const tsconfigBefore = readFileSync(tsconfig, "utf8");
const build = spawnSync("pnpm", ["exec", "next", "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    KILN_SITE_EXPORT: "1",
    NEXT_PUBLIC_KILN_BASE: base,
    NEXT_PUBLIC_KILN_START: start,
    NEXT_TELEMETRY_DISABLED: "1",
    // The build reads no database; Prisma's client only wants an address.
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgresql://kiln:kiln@localhost:5432/kiln",
  },
});
writeFileSync(tsconfig, tsconfigBefore);
if (build.status !== 0) process.exit(build.status ?? 1);

const html = join(dist, "server", "app", "index.html");
if (!existsSync(html)) {
  console.error(
    "The build left no prerendered page (.next-site/server/app/index.html): the public page must stay static.",
  );
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(html, join(out, "index.html"));
cpSync(join(dist, "static"), join(out, "_next", "static"), { recursive: true });
cpSync(join(root, "public", "home", "board"), join(out, "home", "board"), {
  recursive: true,
});
cpSync(join(root, "src", "app", "favicon.ico"), join(out, "favicon.ico"));
const notFound = join(dist, "server", "app", "_not-found.html");
if (existsSync(notFound)) cpSync(notFound, join(out, "404.html"));
// GitHub Pages runs Jekyll by default, which drops folders that start with _.
writeFileSync(join(out, ".nojekyll"), "");

// Every file the page names must be in site/, under the base it was built for.
const page = readFileSync(join(out, "index.html"), "utf8");
const named = new Set();
for (const match of page.matchAll(
  /(?:src|href|poster)="([^"#?]+)(?:\?[^"]*)?"/g,
)) {
  named.add(match[1]);
}
for (const match of page.matchAll(/url\(([^)"']+)\)/g)) named.add(match[1]);
const missing = [];
const outside = [];
let checked = 0;
for (const path of named) {
  if (/^(https?:|data:|mailto:)/.test(path)) continue;
  if (!path.startsWith("/")) continue;
  if (path === base || path === `${base}/`) continue;
  if (base && !path.startsWith(`${base}/`)) {
    outside.push(path);
    continue;
  }
  checked++;
  const file = join(out, decodeURIComponent(path.slice(base.length)));
  if (!existsSync(file)) missing.push(path);
}
if (outside.length > 0 || missing.length > 0) {
  for (const path of outside) {
    console.error(`outside the base ${base}: ${path}`);
  }
  for (const path of missing) console.error(`not in site/: ${path}`);
  process.exit(1);
}
if (page.includes('href="/projects"')) {
  console.error(
    '"Get started" still leads to /projects, which a static site lacks.',
  );
  process.exit(1);
}
console.log(
  `site/ is ready: ${checked} files the page names are there, served under "${base || "/"}", and it starts at ${start}.`,
);
