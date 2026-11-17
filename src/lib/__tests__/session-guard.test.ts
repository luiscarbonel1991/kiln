import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Nothing a signed-in person can reach runs for anyone else: every Server
// Action starts by requiring the maker, and every route handler checks a
// session or an access token. New code that forgets fails here.
const app = join(import.meta.dirname, "..", "..", "app");

function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : files(path, match);
    }
    return match.test(name) ? [path] : [];
  });
}

// The first run's own action: it is how the first session comes to exist.
const OPEN_ACTIONS = new Set(["account.ts"]);
// Better Auth's own endpoints, and a schema file anyone may read.
const OPEN_ROUTES = new Set([
  join("api", "auth", "[...all]", "route.ts"),
  join("templates", "product-package.schema.json", "route.ts"),
]);

// The public page, the account pages and a static preview.
const OPEN_PAGES = new Set([
  "page.tsx",
  join("sign-in", "page.tsx"),
  join("sign-up", "page.tsx"),
  join("welcome", "page.tsx"),
  join("preview", "page.tsx"),
]);

describe("the session guard", () => {
  it("every page of the studio requires the maker before it renders", () => {
    const pages = files(app, /^page\.tsx$/).filter(
      (path) => !OPEN_PAGES.has(relative(app, path)),
    );
    expect(pages.length).toBeGreaterThan(8);
    const unguarded = pages.filter(
      (path) =>
        !/^export default async function [\s\S]*?\{\n {2}await requireMaker\(\);/m.test(
          readFileSync(path, "utf8"),
        ),
    );
    expect(unguarded.map((path) => relative(app, path))).toEqual([]);
  });

  it("every Server Action requires the maker before anything else", () => {
    const actions = files(join(app, "actions"), /\.ts$/).filter(
      (path) => !OPEN_ACTIONS.has(relative(join(app, "actions"), path)),
    );
    expect(actions.length).toBeGreaterThan(15);
    const unguarded = actions.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const exported = source.match(/^export async function \w+/gm) ?? [];
      const guarded =
        source.match(
          /^export async function [\s\S]*?\{\n {2}await requireMaker\(\);/gm,
        ) ?? [];
      const loose = /^export (const|function) /m.test(source);
      return exported.length === guarded.length && !loose
        ? []
        : [relative(app, path)];
    });
    expect(unguarded).toEqual([]);
  });

  it("every route handler checks a session or a token", () => {
    const routes = files(app, /^route\.ts$/).filter(
      (path) => !OPEN_ROUTES.has(relative(app, path)),
    );
    expect(routes.length).toBeGreaterThan(10);
    const unguarded = routes.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      // A handler that only answers "method not allowed" has nothing to guard.
      const handlers = (
        source.match(
          /^export async function (GET|POST|PUT|PATCH|DELETE)\b[^{]*\{\n\s+(?!\s|return apiError\(\s*405)/gm,
        ) ?? []
      ).length;
      const checks =
        source.match(
          /await (authorize|authorizeToken|denyWithoutSession|requireMaker)\(/g,
        )?.length ?? 0;
      return checks >= handlers ? [] : [relative(app, path)];
    });
    expect(unguarded).toEqual([]);
  });
});
