#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { rasterType } from "@kiln/engine/domain/image-type";
import {
  packageJsonSchema,
  parseProductPackage,
} from "@kiln/engine/domain/product-package";
import { run } from "./run.js";

// The `kiln` command: run.ts with the real file system, network and engine.
process.exitCode = await run(process.argv.slice(2), {
  engine: { parseProductPackage, packageJsonSchema, rasterType },
  // `pnpm kiln …` runs in Kiln's folder; paths are the caller's.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  readText: (path) => readFile(path, "utf8"),
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
