import { rasterType } from "@kiln/engine/domain/image-type";
import {
  packageJsonSchema,
  parseProductPackage,
} from "@kiln/engine/domain/product-package";
import { describe, expect, it } from "vitest";
import { type Io, run } from "../run";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface Sent {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

const product = (sku: string, name: string, colours: string[]) => ({
  id: `cli:${sku}`,
  sku,
  name,
  family: "Kitchen",
  dimensions: { w: 12, h: 8, unit: "in" },
  shape: "rectangular board",
  material: "hardwood",
  treatment: "engraved",
  colours: colours.map((key) => ({
    key,
    name: key[0].toUpperCase() + key.slice(1),
    face: "#C8A165",
  })),
  defaultColour: colours[0],
  typography: { family: "Fraunces" },
  source: { kind: "form" },
});

// A package the import takes: two products, one with two colours.
const pkg = {
  products: [
    product("CB-01", "Cutting board", ["maple", "walnut"]),
    product("CO-02", "Coaster", ["natural"]),
  ],
};

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
  const file = (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
  const io: Io = {
    engine: { parseProductPackage, packageJsonSchema, rasterType },
    cwd: "/work",
    env,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readText: async (path) => file(path).toString(),
    readBytes: async (path) => new Uint8Array(Buffer.from(file(path))),
    fetch: async (url, init) => {
      const s: Sent = { url, ...init };
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

describe("kiln projects, frames, approve", () => {
  const frames = {
    project: { id: "p1", name: "Coaster listing kit" },
    frames: [
      {
        frame: "etsy.hero",
        label: "Marketplace hero",
        state: "to-review",
        failed: false,
        output: "https://storage/hero-2.png",
        approvedOutput: null,
        approvable: true,
      },
      {
        frame: "etsy.size",
        label: "Size & spec",
        state: "exact",
        failed: false,
        output: null,
        approvedOutput: null,
        approvable: false,
      },
      {
        frame: "etsy.in-use",
        label: "In-use mockup",
        state: "queued",
        failed: true,
        error: "the provider timed out",
        output: null,
        approvedOutput: null,
        approvable: false,
      },
    ],
  };

  it("lists the projects, and a project's frames with the take to check", async () => {
    const c = cli({}, (sent) =>
      sent.url.endsWith("/api/projects")
        ? {
            status: 200,
            body: {
              projects: [
                {
                  id: "p1",
                  name: "Coaster listing kit",
                  type: "listing-kit",
                  phase: "generation",
                },
              ],
            },
          }
        : { status: 200, body: frames },
    );
    expect(await c.run("projects")).toBe(0);
    expect(c.out).toEqual(["p1  listing-kit Coaster listing kit"]);
    expect(await c.run("frames", "p1")).toBe(0);
    expect(c.sent[1]).toMatchObject({
      url: "http://kiln.test/api/projects/p1/frames",
      method: "GET",
      headers: { Authorization: "Bearer kiln_pat_test" },
    });
    expect(c.out.slice(1)).toEqual([
      "etsy.hero    to-review  Marketplace hero · https://storage/hero-2.png",
      "etsy.size    exact      Size & spec",
      "etsy.in-use  queued     In-use mockup · failed: the provider timed out",
      "1 to review. After your check: kiln approve p1 <frame> <take>",
    ]);
  });

  it("approves the take that was checked, and withdraws with a DELETE", async () => {
    const c = cli({}, () => ({
      status: 200,
      body: {
        frame: {
          ...frames.frames[0],
          state: "approved",
          approvedOutput: "https://storage/hero-2.png",
        },
      },
    }));
    expect(
      await c.run("approve", "p1", "etsy.hero", "https://storage/hero-2.png"),
    ).toBe(0);
    expect(c.sent[0]).toMatchObject({
      url: "http://kiln.test/api/projects/p1/frames/etsy/hero/approval",
      method: "PUT",
      body: JSON.stringify({ output: "https://storage/hero-2.png" }),
    });
    expect(c.out).toEqual(["approved  etsy.hero · https://storage/hero-2.png"]);
    expect(await c.run("unapprove", "p1", "etsy.hero")).toBe(0);
    expect(c.sent[1].method).toBe("DELETE");
  });

  it("passes a stale take's refusal on (exit 1), and needs a frame (exit 2)", async () => {
    const c = cli({}, () => ({
      status: 409,
      body: {
        error:
          "A newer take landed since: https://storage/hero-3.png. Check it, then approve that one.",
      },
    }));
    expect(
      await c.run("approve", "p1", "etsy.hero", "https://storage/hero-2.png"),
    ).toBe(1);
    expect(c.err[0]).toMatch(/A newer take landed since/);
    expect(await c.run("approve", "p1", "hero")).toBe(2);
    expect(await c.run("frames")).toBe(2);
    expect(c.sent).toHaveLength(1);
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
