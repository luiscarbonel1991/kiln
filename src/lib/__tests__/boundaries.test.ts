import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Kiln's core is generic too (CLAUDE.md "Boundaries"): outside the optional
// modules (src/modules, off unless KILN_MODULES lists them), no app source
// names a maker, signs and their formats, acrylic or laser work — the same
// words as the engine's guard. The only exception is the wiring that names
// the laser-pricing module by its id.
const root = join(import.meta.dirname, "..", "..");
const LEAK =
  /maker1|\bsigns?\b|acrylic|laser|hanger|plaque|house.?numbers?|no.?soliciting/i;
const MODULE_WIRING = /laser-pricing/;
const SKIP = new Set(["__tests__", "__fixtures__", "modules"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return SKIP.has(name) ? [] : sources(path);
    }
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("core boundaries", () => {
  it("no core source names a maker, signs and their formats, acrylic or laser work", () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(80);
    const leaks = files.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${relative(root, path)}:${i + 1}` }))
        .filter(({ line }) => LEAK.test(line) && !MODULE_WIRING.test(line))
        .map(({ at, line }) => `${at} ${line.trim()}`),
    );
    expect(leaks).toEqual([]);
  });
});
