import { describe, expect, it } from "vitest";
import {
  packageJsonSchema,
  parseProductPackage,
} from "@/domain/product-package";
import pkg from "@/lib/__fixtures__/product-package.json";

const [board] = pkg.products;

describe("parseProductPackage", () => {
  it("accepts { products }, an array, or a single product", () => {
    expect(parseProductPackage(pkg)).toMatchObject({ ok: true });
    expect(parseProductPackage(pkg.products)).toMatchObject({ ok: true });
    const single = parseProductPackage(board);
    expect(single.ok && single.products.map((p) => p.sku)).toEqual(["CB-01"]);
  });

  it("names a rejected product and its field in words; the others still import", () => {
    const bad = {
      ...board,
      sku: "CB-02",
      colours: [
        { ...board.colours[0], face: "brown" },
        { ...board.colours[1], inlayName: "x".repeat(52) },
      ],
    };
    const result = parseProductPackage({ products: [bad, pkg.products[1]] });
    expect(result.ok && result.products.map((p) => p.sku)).toEqual([
      pkg.products[1].sku,
    ]);
    expect(result.ok && result.rejected).toEqual([
      {
        label: '"CB-02" Engraved family cutting board',
        errors: [
          "colours › maple › face: hex colour like #4B5F50",
          "colours › walnut › inlayName: at most 40 characters (this one has 52)",
        ],
      },
    ]);
  });

  it("says what is missing or not one of the choices, and names a product with no sku by its place", () => {
    const { name: _name, ...noName } = board;
    const result = parseProductPackage([
      { ...noName, treatment: "carved" },
      { shape: "mug" },
    ]);
    const rejected = result.ok ? result.rejected : [];
    expect(rejected[0]).toEqual({
      label: '"CB-01"',
      errors: [
        "name: is missing",
        "treatment: should be one of raised, inlaid, engraved, printed, cut",
      ],
    });
    expect(rejected[1].label).toBe("product #2");
  });

  it("refuses an empty package; a repeated sku keeps the first", () => {
    expect(parseProductPackage({ products: [] }).ok).toBe(false);
    expect(parseProductPackage("hello").ok).toBe(false);
    const twice = parseProductPackage([board, board]);
    expect(twice.ok && twice.products).toHaveLength(1);
    expect(twice.ok && twice.rejected).toEqual([
      {
        label: '"CB-01" Engraved family cutting board',
        errors: ['sku "CB-01" appears earlier in the package'],
      },
    ]);
  });

  it("reads the maker's brand kit from the maker block", () => {
    const result = parseProductPackage(pkg);
    expect(result.ok && result.brand).toEqual({
      palette: ["#2F4A3A", "#E9E1D2"],
      handle: "northwindmakers",
      url: "https://northwind.example",
    });
    const none = parseProductPackage([board]);
    expect(none.ok && none.brand).toBeUndefined();
  });

  it("a bad brand kit is left unsaved with its reasons; the products still import", () => {
    const result = parseProductPackage({
      maker: { palette: ["green"], handle: "has spaces" },
      products: [board],
    });
    expect(result.ok && result.products).toHaveLength(1);
    expect(result.ok && result.brand).toBeUndefined();
    expect(result.ok && result.brandErrors.join(" ")).toMatch(/palette › #1/);
    expect(result.ok && result.brandErrors.join(" ")).toMatch(/handle/);
  });

  it("the brand link is a web address, never a script or data URL", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi"]) {
      const result = parseProductPackage({ maker: { url }, products: [board] });
      expect(result.ok && result.brandErrors.join(" ")).toMatch(/^url/);
    }
    const ok = parseProductPackage({
      maker: { url: "http://shop.example" },
      products: [board],
    });
    expect(ok.ok).toBe(true);
  });

  it("the example package is generic: no maker's catalog, no signs", () => {
    expect(JSON.stringify(pkg).toLowerCase()).not.toMatch(
      /maker1|\bsigns?\b|acrylic/,
    );
  });

  it("publishes its limits as a JSON Schema, generated from the same schema", () => {
    const schema = packageJsonSchema() as {
      properties: {
        products: {
          items: {
            required: string[];
            properties: Record<string, Record<string, unknown>>;
          };
        };
      };
    };
    const item = schema.properties.products.items;
    expect(item.required).toContain("defaultColour");
    expect(item.properties.hook).toMatchObject({ maxLength: 80 });
    const colours = item.properties.colours as {
      items: { properties: Record<string, unknown> };
    };
    expect(colours.items.properties.inlayName).toMatchObject({ maxLength: 40 });
    expect(colours.items.properties.swatchUrl).toMatchObject({
      description: expect.stringContaining("photo of the material"),
    });
  });
});
