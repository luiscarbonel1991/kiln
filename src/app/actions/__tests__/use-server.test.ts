import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A "use server" module may export only async functions (and type
// declarations, which are erased). Next's action compiler reads a local
// `export { x }` or `export type { X }` as a runtime export: the module then
// fails to load and every action on the page with it (seen 10/29: the board's
// reference upload failed after `export type { DeliverResult }`).
const dir = join(import.meta.dirname, "..");

describe('"use server" modules', () => {
  it("re-export nothing of their own with export { } or export type { }", () => {
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => {
        const text = readFileSync(join(dir, f), "utf8");
        if (!text.startsWith('"use server"')) return [];
        return text
          .split("\n")
          .filter((line) => /^export (type )?\{[^}]*\};?$/.test(line.trim()))
          .map((line) => `${f}: ${line.trim()}`);
      });
    expect(offenders).toEqual([]);
  });
});
