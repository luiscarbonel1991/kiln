import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { LEAK } from "./leak";

// The engine is generic (CONTRIBUTING.md, "What Kiln leaves out"): nothing in
// Kiln's code may know about signs or a particular maker. Its sources, comments
// included, never name a maker, signs or their formats (plaques, door hangers,
// house numbers, "no soliciting"), acrylic or laser work. "Engraved" stays: a
// generic treatment (wood, metal, jewellery).
const root = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sources(path);
    }
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

// A provider SDK is imported only inside its own adapter folder
// (CONTRIBUTING.md, "What Kiln leaves out"), in the engine and in the app. The
// AI SDK's loop and UI (`ai`, `@ai-sdk/react`) stay in the chat.
const SDK = [
  { from: /from "openai(\/[^"]*)?"/, homes: ["providers/openai/"] },
  { from: /from "@google\/genai"/, homes: ["providers/google/"] },
  { from: /from "@ai-sdk\/openai"/, homes: ["providers/openai/"] },
  { from: /from "@ai-sdk\/google"/, homes: ["providers/google/"] },
  {
    from: /from "(ai|@ai-sdk\/react)(\/[^"]*)?"/,
    homes: ["src/server/chat/", "src/components/chat/", "src/app/api/chat/"],
  },
];

describe("engine boundaries", () => {
  it("no engine source names a maker, signs and their formats, acrylic or laser work", () => {
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

  it("a provider SDK is imported only inside its adapter", () => {
    const app = join(root, "..", "..", "..", "src");
    const files = [...sources(root), ...sources(app)];
    const strays = files.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return SDK.filter(
        (sdk) =>
          sdk.from.test(text) && !sdk.homes.some((home) => path.includes(home)),
      ).map(() => relative(join(root, "..", "..", ".."), path));
    });
    expect(strays).toEqual([]);
  });
});
