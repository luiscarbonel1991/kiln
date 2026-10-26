#!/usr/bin/env node
// kiln — feed Kiln without a file picker (ROADMAP 2026-10-26, P0-1).
//
//   kiln validate <package.json>             the import's own checks, offline
//   kiln import <package.json>               check, then POST /api/import
//   kiln swatch <product> <colour> <photo>   a colour's material photo
//   kiln swatch <product> <colour> --remove
//   kiln schema                              the package's JSON Schema
//
// The checks are the engine's (`parseProductPackage`, `rasterType`, from
// packages/engine/dist: `pnpm engine:build` once), so an exporter fails at
// build time with the words the import would use. KILN_URL and KILN_TOKEN
// (Settings → Access tokens) say where to send. `run` takes its I/O as
// arguments, for tests.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = `Usage:
  kiln validate <package.json>             check a product package, offline
  kiln import <package.json>               check it, then import it into Kiln
  kiln swatch <product> <colour> <photo>   set a colour's material photo
  kiln swatch <product> <colour> --remove  remove it
  kiln schema                              print the package's JSON Schema

<product> is its sku or Kiln id, <colour> its key. --json prints Kiln's
answer as JSON.

Environment: KILN_URL (where Kiln runs, e.g. http://localhost:3009) and
KILN_TOKEN (a personal access token: Settings → Access tokens).

Exit: 0 done · 1 something set aside or refused · 2 usage · 3 Kiln did not
answer, or refused the token.`;

const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);

const dataMime = (url) => /^data:([^;,]+)/.exec(url)?.[1]?.toLowerCase();

// What the import refuses that the schema cannot say, read without a
// network: an inline photo or material sample that is not a PNG, JPEG or
// WebP. Assets at other addresses are the server's to allow.
function inlineProblems(product) {
  const problems = [];
  const photo =
    product.source?.kind === "photo" ? product.source.assetUrl : null;
  if (photo?.startsWith("data:") && !RASTER.has(dataMime(photo))) {
    problems.push(
      "source › assetUrl: its photo must be a PNG, JPEG or WebP image",
    );
  }
  for (const c of product.colours) {
    if (
      c.swatchUrl?.startsWith("data:") &&
      !RASTER.has(dataMime(c.swatchUrl))
    ) {
      problems.push(
        `colours › ${c.key} › swatchUrl: a material sample must be a PNG, JPEG or WebP image`,
      );
    }
  }
  return problems;
}

const label = (p) => `"${p.sku}" ${p.name}`;

// The package checked as the import checks it: the products that pass, those
// set aside with why, and the maker block's errors.
function check(engine, json) {
  const parsed = engine.parseProductPackage(json);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const ready = [];
  const rejected = [...parsed.rejected];
  for (const product of parsed.products) {
    const problems = inlineProblems(product);
    if (problems.length > 0)
      rejected.push({ label: label(product), errors: problems });
    else ready.push(product);
  }
  return { ok: true, ready, rejected, brandErrors: parsed.brandErrors };
}

function printRejected(out, rejected) {
  for (const r of rejected) {
    out(`set aside ${r.label}`);
    for (const e of r.errors) out(`  - ${e}`);
  }
}

async function readJson(io, file) {
  const text = await io.readFile(file, "utf8");
  try {
    return { json: JSON.parse(text) };
  } catch (error) {
    return { error: `${file}: not JSON (${error.message})` };
  }
}

function connection(io) {
  const url = io.env.KILN_URL?.replace(/\/+$/, "");
  const token = io.env.KILN_TOKEN;
  if (!url || !token) {
    io.err(
      `Set ${!url ? "KILN_URL (where Kiln runs, e.g. http://localhost:3009)" : ""}${!url && !token ? " and " : ""}${!token ? "KILN_TOKEN (Settings → Access tokens)" : ""}.`,
    );
    return null;
  }
  return { url, token };
}

// One call to Kiln: its JSON answer and status, or an exit code when it did
// not answer or refused the token.
async function call(io, conn, path, init) {
  let res;
  try {
    res = await io.fetch(`${conn.url}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${conn.token}` },
    });
  } catch (error) {
    io.err(
      `Kiln did not answer at ${conn.url} (${error.cause?.code ?? error.message}). Is it running?`,
    );
    return { exit: 3 };
  }
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status === 401) {
    io.err(body.error ?? "Kiln refused the token.");
    return { exit: 3 };
  }
  return { status: res.status, body };
}

async function validate(io, engine, file, flags) {
  const read = await readJson(io, file);
  if (read.error) {
    io.err(read.error);
    return 1;
  }
  const result = check(engine, read.json);
  if (flags.json) {
    io.out(
      JSON.stringify(
        result.ok
          ? {
              ok:
                result.rejected.length === 0 && result.brandErrors.length === 0,
              ready: result.ready.map((p) => ({ sku: p.sku, name: p.name })),
              rejected: result.rejected,
              brandErrors: result.brandErrors,
            }
          : { ok: false, errors: result.errors },
        null,
        2,
      ),
    );
  } else if (!result.ok) {
    for (const e of result.errors) io.out(e);
  } else {
    for (const p of result.ready) {
      io.out(
        `ok        ${label(p)} · ${p.colours.length} colour${p.colours.length === 1 ? "" : "s"}`,
      );
    }
    printRejected(io.out, result.rejected);
    for (const e of result.brandErrors) io.out(`maker block not saved: ${e}`);
    io.out(
      `${result.ready.length} ready, ${result.rejected.length} set aside${result.brandErrors.length > 0 ? ", maker block refused" : ""}.`,
    );
  }
  return result.ok &&
    result.rejected.length === 0 &&
    result.brandErrors.length === 0
    ? 0
    : 1;
}

async function importPackage(io, engine, file, flags) {
  const conn = connection(io);
  if (!conn) return 2;
  const read = await readJson(io, file);
  if (read.error) {
    io.err(read.error);
    return 1;
  }
  const checked = check(engine, read.json);
  if (!checked.ok || checked.ready.length === 0) {
    if (!checked.ok) for (const e of checked.errors) io.err(e);
    else printRejected(io.err, checked.rejected);
    io.err("Nothing to import: nothing was sent.");
    return 1;
  }
  if (
    flags.strict &&
    (checked.rejected.length > 0 || checked.brandErrors.length > 0)
  ) {
    printRejected(io.err, checked.rejected);
    for (const e of checked.brandErrors) io.err(`maker block: ${e}`);
    io.err("--strict: nothing was sent.");
    return 1;
  }
  const answer = await call(io, conn, "/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(read.json),
  });
  if (answer.exit) return answer.exit;
  if (answer.status !== 200) {
    io.err(answer.body.error ?? `Kiln answered ${answer.status}.`);
    return 1;
  }
  const result = answer.body;
  if (flags.json) {
    io.out(JSON.stringify(result, null, 2));
  } else {
    for (const p of result.imported) {
      const changed = p.changed.length > 0 ? `: ${p.changed.join(", ")}` : "";
      io.out(`${p.status.padEnd(9)} ${label(p)}${changed} · id ${p.id}`);
    }
    printRejected(io.out, result.rejected);
    for (const e of result.brandErrors) io.out(`maker block not saved: ${e}`);
    if (result.brandSaved) io.out("brand kit saved");
    for (const w of result.warnings) io.out(`note: ${w}`);
  }
  return result.rejected.length > 0 || result.brandErrors.length > 0 ? 1 : 0;
}

async function swatch(io, args, flags) {
  const [product, colour, photo] = args;
  if (!product || !colour || (!photo && !flags.remove)) {
    io.err(USAGE);
    return 2;
  }
  const conn = connection(io);
  if (!conn) return 2;
  const path = `/api/products/${encodeURIComponent(product)}/colours/${encodeURIComponent(colour)}/swatch`;
  let init = { method: "DELETE", headers: {} };
  if (!flags.remove) {
    const bytes = await io.readFile(photo);
    const type = io.engine.rasterType(bytes);
    if (!type) {
      io.err(
        `${photo}: a material photo must be a PNG, JPEG or WebP image. Nothing was sent.`,
      );
      return 1;
    }
    init = { method: "POST", headers: { "Content-Type": type }, body: bytes };
  }
  const answer = await call(io, conn, path, init);
  if (answer.exit) return answer.exit;
  if (answer.status !== 200) {
    io.err(answer.body.error ?? `Kiln answered ${answer.status}.`);
    return 1;
  }
  const r = answer.body;
  if (flags.json) {
    io.out(JSON.stringify(r, null, 2));
    return 0;
  }
  const what = `${r.colour.name} of ${label(r.product)}`;
  if (r.status === "unchanged") {
    io.out(
      `${what}: no change (${r.colour.swatchUrl ? "that photo is already its sample" : "it has no sample"}).`,
    );
  } else {
    io.out(
      r.colour.swatchUrl
        ? `${what}: material photo set · ${r.colour.swatchUrl}`
        : `${what}: material photo removed.`,
    );
  }
  if (
    r.photoColour &&
    r.photoColour.hex.toLowerCase() !== r.colour.face.toLowerCase()
  ) {
    io.out(
      `The photo reads ${r.photoColour.hex} (${r.photoColour.name}); the swatch stays ${r.colour.face}. If the photo is the truth, change the swatch on the product page.`,
    );
  }
  if (r.behind.length > 0) {
    io.out(
      `Following an earlier version: ${r.behind.map((b) => b.name).join(", ")}. "Update the project" on each board.`,
    );
  }
  return 0;
}

export async function run(argv, io) {
  const flags = {
    json: argv.includes("--json"),
    remove: argv.includes("--remove"),
    strict: argv.includes("--strict"),
  };
  const [command, ...args] = argv.filter((a) => !a.startsWith("--"));
  const file = args[0] ? resolve(io.cwd, args[0]) : null;
  switch (command) {
    case "validate":
      if (!file) break;
      return validate(io, io.engine, file, flags);
    case "import":
      if (!file) break;
      return importPackage(io, io.engine, file, flags);
    case "swatch":
      return swatch(
        io,
        [args[0], args[1], args[2] ? resolve(io.cwd, args[2]) : undefined],
        flags,
      );
    case "schema":
      io.out(JSON.stringify(io.engine.packageJsonSchema(), null, 2));
      return 0;
    case "help":
    case undefined:
      io.out(USAGE);
      return command ? 0 : 2;
  }
  io.err(USAGE);
  return 2;
}

// The engine's package contract and image check, from its build.
async function loadEngine() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = (name) =>
    pathToFileURL(
      join(here, "..", "packages", "engine", "dist", "domain", `${name}.js`),
    ).href;
  try {
    return {
      ...(await import(dist("product-package"))),
      ...(await import(dist("image-type"))),
    };
  } catch {
    console.error(
      "The engine is not built: run `pnpm engine:build` in Kiln's folder once.",
    );
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const code = await run(process.argv.slice(2), {
    engine: await loadEngine(),
    // `pnpm kiln …` runs in Kiln's folder; paths are the caller's.
    cwd: process.env.INIT_CWD ?? process.cwd(),
    env: process.env,
    fetch,
    readFile,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exitCode = code;
}
