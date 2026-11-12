import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { sampleStory } from "@/lib/home-story";
import { GET_STARTED } from "@/lib/site";

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

  it("tells every step with the sample alone", () => {
    const story = sampleStory();
    expect(story.project).toBeNull();
    expect(story.exact).toHaveLength(3);
    expect(story.scenes).toHaveLength(4);
    expect(story.scenes.map((s) => s.check?.status)).toContain("failed");
    expect(story.looks.length).toBeGreaterThanOrEqual(3);
    expect(story.words?.title.length).toBeLessThanOrEqual(
      story.words?.titleMax ?? 0,
    );
    expect(story.destinations.length).toBeGreaterThan(1);
  });

  it("starts a visitor in one place, never back on itself", () => {
    expect(GET_STARTED).toEqual({ href: "/projects", label: "Get started" });
  });
});
