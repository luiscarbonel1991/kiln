import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GET_STARTED } from "@/lib/site";
import { siteKit } from "@/lib/site-kit";
import { LEAK } from "../../../packages/engine/src/__tests__/leak";

// The public page is built once and needs no database: nothing it imports, at
// any depth, reaches the server's repositories, the database client or
// Prisma. Read from the source, following the app's path aliases.
const repo = join(import.meta.dirname, "..", "..", "..");
const ALIASES: [string, string][] = [
  ["@/domain/", "packages/engine/src/domain/"],
  ["@/providers/", "packages/engine/src/providers/"],
  ["@/", "src/"],
];
const SPECIFIERS =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;

function resolve(from: string, spec: string): string | null {
  const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix));
  const base = alias
    ? join(repo, alias[1], spec.slice(alias[0].length))
    : spec.startsWith(".")
      ? join(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const path = base + ext;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

// Every source file and package the entry reaches.
function reach(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const [, spec] of readFileSync(file, "utf8").matchAll(SPECIFIERS)) {
      const next = resolve(file, spec);
      if (next) queue.push(next);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) {
        packages.add(spec);
      }
    }
  }
  return { files: [...files].map((f) => relative(repo, f)), packages };
}

describe("the public page", () => {
  it("reaches no database, repository or Prisma, at any depth", () => {
    const { files, packages } = reach(join(repo, "src/app/page.tsx"));
    expect(files).toContain("src/components/site/site-made.tsx");
    expect(files).toContain("src/lib/site-kit.ts");
    expect(files.filter((f) => /^src\/(server\/|lib\/db\.ts)/.test(f))).toEqual(
      [],
    );
    expect([...packages].filter((p) => p.startsWith("@prisma/"))).toEqual([]);
  });

  it("tells every step with its sample kit alone, from files it ships", () => {
    const kit = siteKit();
    expect(kit.frames.length).toBeGreaterThanOrEqual(3);
    expect(kit.colours.length).toBeGreaterThanOrEqual(3);
    expect(kit.words?.title.length).toBeLessThanOrEqual(
      kit.words?.titleMax ?? 0,
    );
    const files = [
      kit.plate.href,
      kit.video.url,
      kit.video.poster,
      ...Object.values(kit.loupes),
      ...Object.values(kit.takes).map((t) => t.url),
      ...kit.colours.map((c) => c.take.url),
    ];
    for (const file of files) {
      expect(existsSync(join(repo, "public", file)), file).toBe(true);
    }
    expect(JSON.stringify(kit)).not.toMatch(LEAK);
  });

  it("starts a visitor in one place, never back on itself", () => {
    expect(GET_STARTED).toEqual({ href: "/projects", label: "Get started" });
  });
});
