import { describe, expect, it } from "vitest";
import { rasterType } from "@/domain/image-type";
import {
  packageJsonSchema,
  parseProductPackage,
} from "@/domain/product-package";
import pkg from "@/lib/__fixtures__/product-package.json";
import { run } from "../kiln.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

// The CLI with its I/O in memory: files by absolute path, Kiln answering
// from `answer`, what it printed and what it sent.
function cli(
  files: Record<string, string | Buffer>,
  answer: (sent: Sent) => { status: number; body: unknown } = () => ({
    status: 200,
    body: {},
  }),
  env: Record<string, string> = {
    KILN_URL: "http://kiln.test/",
    KILN_TOKEN: "kiln_pat_test",
  },
) {
  const out: string[] = [];
  const err: string[] = [];
  const sent: Sent[] = [];
  const io = {
    engine: { parseProductPackage, packageJsonSchema, rasterType },
    cwd: "/work",
    env,
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    readFile: async (path: string, encoding?: string) => {
      const file = files[path];
      if (file === undefined) throw new Error(`ENOENT: ${path}`);
      return encoding ? file.toString() : Buffer.from(file);
    },
    fetch: async (url: string, init: Omit<Sent, "url">) => {
      const s = { url, ...init };
      sent.push(s);
      const { status, body } = answer(s);
      return new Response(JSON.stringify(body), { status });
    },
  };
  return {
    out,
    err,
    sent,
    run: (...argv: string[]) => run(argv, io),
  };
}

const [board, coaster] = pkg.products;
const long = {
  ...coaster,
  colours: [{ ...coaster.colours[0], inlayName: "x".repeat(52) }],
};

describe("kiln validate", () => {
  it("passes a package the import takes, offline, naming each product", async () => {
    const c = cli({ "/work/pkg.json": JSON.stringify(pkg) });
    expect(await c.run("validate", "pkg.json")).toBe(0);
    expect(c.out.at(-1)).toBe(`${pkg.products.length} ready, 0 set aside.`);
    expect(c.out[0]).toMatch(/^ok {8}"CB-01" /);
    expect(c.sent).toEqual([]);
  });

  it("fails with the import's own words for a field over its limit (exit 1)", async () => {
    const c = cli({
      "/work/pkg.json": JSON.stringify({ products: [board, long] }),
    });
    expect(await c.run("validate", "pkg.json")).toBe(1);
    expect(c.out).toContain(
      `  - colours › ${coaster.colours[0].key} › inlayName: at most 40 characters (this one has 52)`,
    );
    expect(c.out.at(-1)).toBe("1 ready, 1 set aside.");
  });

  it("catches an inline material sample that is not a photo, which the schema cannot", async () => {
    const svgSwatch = {
      ...board,
      colours: [
        {
          ...board.colours[0],
          swatchUrl: "data:image/svg+xml;base64,PHN2Zy8+",
        },
        ...board.colours.slice(1),
      ],
    };
    const c = cli({ "/work/pkg.json": JSON.stringify([svgSwatch]) });
    expect(await c.run("validate", "pkg.json", "--json")).toBe(1);
    const result = JSON.parse(c.out.join("\n"));
    expect(result.rejected[0].errors).toEqual([
      `colours › ${board.colours[0].key} › swatchUrl: a material sample must be a PNG, JPEG or WebP image`,
    ]);
  });

  it("says when a file is not JSON or not a package", async () => {
    const c = cli({ "/work/a.json": "{", "/work/b.json": "[]" });
    expect(await c.run("validate", "a.json")).toBe(1);
    expect(c.err[0]).toMatch(/^\/work\/a\.json: not JSON/);
    expect(await c.run("validate", "b.json")).toBe(1);
    expect(c.out[0]).toMatch(/^No products found/);
  });
});

describe("kiln import", () => {
  it("checks, then sends the package with the token, and prints what Kiln did", async () => {
    const c = cli({ "/work/pkg.json": JSON.stringify(pkg) }, () => ({
      status: 200,
      body: {
        imported: [
          {
            id: "p1",
            sku: "CB-01",
            name: "Board",
            status: "updated",
            changed: ["size"],
            colours: [],
          },
          {
            id: "p2",
            sku: "CO-01",
            name: "Coaster",
            status: "unchanged",
            changed: [],
            colours: [],
          },
        ],
        rejected: [],
        brandSaved: false,
        brandErrors: [],
        warnings: ['"CO-01" Coaster: kept the material photo of Oak.'],
      },
    }));
    expect(await c.run("import", "pkg.json")).toBe(0);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toMatchObject({
      url: "http://kiln.test/api/import",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer kiln_pat_test",
      },
    });
    expect(JSON.parse(String(c.sent[0].body))).toEqual(pkg);
    expect(c.out).toEqual([
      'updated   "CB-01" Board: size · id p1',
      'unchanged "CO-01" Coaster · id p2',
      'note: "CO-01" Coaster: kept the material photo of Oak.',
    ]);
  });

  it("sends nothing when no product passes, or with --strict when one does not", async () => {
    const none = cli({ "/work/pkg.json": JSON.stringify([long]) });
    expect(await none.run("import", "pkg.json")).toBe(1);
    expect(none.sent).toEqual([]);
    expect(none.err.at(-1)).toBe("Nothing to import: nothing was sent.");
    const strict = cli({
      "/work/pkg.json": JSON.stringify([board, long]),
    });
    expect(await strict.run("import", "pkg.json", "--strict")).toBe(1);
    expect(strict.sent).toEqual([]);
  });

  it("needs KILN_URL and KILN_TOKEN (exit 2); a refused token or no answer is exit 3", async () => {
    const unset = cli({ "/work/pkg.json": JSON.stringify(pkg) }, undefined, {});
    expect(await unset.run("import", "pkg.json")).toBe(2);
    expect(unset.err[0]).toMatch(/KILN_URL .* and KILN_TOKEN/);
    const refused = cli({ "/work/pkg.json": JSON.stringify(pkg) }, () => ({
      status: 401,
      body: { error: "That token is not valid here." },
    }));
    expect(await refused.run("import", "pkg.json")).toBe(3);
    expect(refused.err).toEqual(["That token is not valid here."]);
  });
});

describe("kiln swatch", () => {
  const set = {
    product: { id: "p1", sku: "CB-01", name: "Board" },
    colour: {
      key: "maple",
      name: "Maple",
      face: "#E3C99A",
      swatchUrl: "https://storage/x.png",
    },
    status: "updated",
    changed: ["colours (Maple changed)"],
    behind: [{ projectId: "j1", name: "Board — Launch" }],
    photoColour: { name: "Tan", hex: "#BE956A" },
  };

  it("sends a photo's bytes with its real type, and says what the swatch keeps", async () => {
    const c = cli({ "/work/maple.jpg": PNG }, () => ({
      status: 200,
      body: set,
    }));
    expect(await c.run("swatch", "CB-01", "maple", "maple.jpg")).toBe(0);
    expect(c.sent[0]).toMatchObject({
      url: "http://kiln.test/api/products/CB-01/colours/maple/swatch",
      method: "POST",
      headers: { "Content-Type": "image/png" },
    });
    expect(c.out).toEqual([
      'Maple of "CB-01" Board: material photo set · https://storage/x.png',
      "The photo reads #BE956A (Tan); the swatch stays #E3C99A. If the photo is the truth, change the swatch on the product page.",
      'Following an earlier version: Board — Launch. "Update the project" on each board.',
    ]);
  });

  it("refuses a file that is not a photo before sending; --remove sends a DELETE", async () => {
    const c = cli({ "/work/oak.svg": "<svg/>" }, () => ({
      status: 200,
      body: {
        ...set,
        colour: { ...set.colour, swatchUrl: null },
        photoColour: undefined,
        behind: [],
      },
    }));
    expect(await c.run("swatch", "CB-01", "oak", "oak.svg")).toBe(1);
    expect(c.sent).toEqual([]);
    expect(await c.run("swatch", "CB-01", "maple", "--remove")).toBe(0);
    expect(c.sent[0].method).toBe("DELETE");
    expect(c.out).toEqual(['Maple of "CB-01" Board: material photo removed.']);
  });

  it("passes Kiln's refusal on (exit 1)", async () => {
    const c = cli({ "/work/p.png": PNG }, () => ({
      status: 404,
      body: { error: '"CB-01" has no colour "teak"; its colours are maple.' },
    }));
    expect(await c.run("swatch", "CB-01", "teak", "p.png")).toBe(1);
    expect(c.err).toEqual([
      '"CB-01" has no colour "teak"; its colours are maple.',
    ]);
  });
});

describe("kiln", () => {
  it("prints the JSON Schema, and the usage for anything else (exit 2)", async () => {
    const c = cli({});
    expect(await c.run("schema")).toBe(0);
    expect(JSON.parse(c.out.join("\n")).title).toBe("Kiln product package");
    expect(await c.run("frobnicate")).toBe(2);
    expect(c.err[0]).toMatch(/^Usage:/);
  });
});
