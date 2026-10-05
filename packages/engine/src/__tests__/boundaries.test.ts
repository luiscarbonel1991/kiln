import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The engine is generic (CLAUDE.md "Boundaries", ROADMAP "Domain model":
// nothing in Kiln's code may know about signs or a particular maker). Its
// sources, comments included, never name a maker, signs, acrylic or laser work.
const root = join(import.meta.dirname, "..");
const LEAK = /maker1|\bsigns?\b|acrylic|laser/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sources(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("engine boundaries", () => {
  it("no engine source names a maker, signs, acrylic or laser work", () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(40);
    const leaks = files.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${relative(root, path)}:${i + 1}` }))
        .filter(({ line }) => LEAK.test(line))
        .map(({ at, line }) => `${at} ${line.trim()}`),
    );
    expect(leaks).toEqual([]);
  });
});
