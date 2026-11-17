import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Nothing a signed-in person can reach runs for anyone else: every page
// requires the maker, every Server Action is a makerAction and every route
// handler a session or token route (src/server/guarded.ts), which check who
// is calling before the code inside runs. New code written any other way
// fails here.
const src = join(import.meta.dirname, "..", "..");
const app = join(src, "app");

function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : files(path, match);
    }
    return match.test(name) ? [path] : [];
  });
}

// The first run's own action and the join page's: they are how a session
// comes to exist (each checks the instance or the invitation itself).
const OPEN_ACTIONS = new Set([
  join("app", "actions", "account.ts"),
  join("app", "actions", "join.ts"),
]);
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
  join("invite", "[id]", "page.tsx"),
  join("preview", "page.tsx"),
]);

describe("the session guard", () => {
  it("every page of the studio is a makerPage", () => {
    const pages = files(app, /^page\.tsx$/).filter(
      (path) => !OPEN_PAGES.has(relative(app, path)),
    );
    expect(pages.length).toBeGreaterThan(8);
    const unguarded = pages.filter(
      (path) =>
        !/^export default makerPage\(async function /m.test(
          readFileSync(path, "utf8"),
        ),
    );
    expect(unguarded.map((path) => relative(app, path))).toEqual([]);
  });

  it("every Server Action is written as a makerAction or an ownerAction", () => {
    // Any file of Server Functions, wherever it lives (a module's too).
    const actions = files(src, /\.ts$/).filter(
      (path) =>
        /^"use server";/.test(readFileSync(path, "utf8")) &&
        !OPEN_ACTIONS.has(relative(src, path)),
    );
    expect(actions.length).toBeGreaterThan(15);
    const loose = actions.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter(
          (line) =>
            /^export /.test(line) &&
            !/^export const \w+ = (makerAction|ownerAction)\(/.test(line) &&
            !/^export (type|interface) /.test(line),
        )
        .map((line) => `${relative(src, path)}: ${line}`),
    );
    expect(loose).toEqual([]);
  });

  it("every route handler is written as a session or a token route", () => {
    const routes = files(app, /^route\.ts$/).filter(
      (path) => !OPEN_ROUTES.has(relative(app, path)),
    );
    expect(routes.length).toBeGreaterThan(10);
    const loose = routes.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter(
          (line) =>
            /^export (async function|const) (GET|POST|PUT|PATCH|DELETE)\b/.test(
              line,
            ) &&
            !/= (sessionRoute|signedInRoute|tokenRoute|notAllowed)\(/.test(
              line,
            ),
        )
        .map((line) => `${relative(src, path)}: ${line}`),
    );
    expect(loose).toEqual([]);
  });
});
