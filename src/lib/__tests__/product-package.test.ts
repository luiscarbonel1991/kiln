import { describe, expect, it } from "vitest";
import pkg from "@/lib/__fixtures__/product-package.json";
import { parseProductPackage } from "@/lib/product-package";

const [board] = pkg.products;

describe("parseProductPackage", () => {
  it("accepts { products }, an array, or a single product", () => {
    expect(parseProductPackage(pkg)).toMatchObject({ ok: true });
    expect(parseProductPackage(pkg.products)).toMatchObject({ ok: true });
    const single = parseProductPackage(board);
    expect(single.ok && single.products.map((p) => p.sku)).toEqual(["CB-01"]);
  });

  it("names the failing field with its path", () => {
    const bad = {
      products: [
        { ...board, colours: [{ ...board.colours[0], face: "brown" }] },
      ],
    };
    const result = parseProductPackage(bad);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(
      /^products\[0\]\.colours\[0\]\.face: /,
    );
  });

  it("refuses an empty package and repeated skus", () => {
    expect(parseProductPackage({ products: [] }).ok).toBe(false);
    const twice = parseProductPackage([board, board]);
    expect(!twice.ok && twice.errors).toEqual(['sku "CB-01" appears twice']);
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

  it("refuses a bad brand kit with its path", () => {
    const result = parseProductPackage({
      maker: { palette: ["green"], handle: "has spaces" },
      products: [board],
    });
    expect(!result.ok && result.errors.join(" ")).toMatch(
      /maker\.palette\[0\]/,
    );
    expect(!result.ok && result.errors.join(" ")).toMatch(/maker\.handle/);
  });

  it("the brand link is a web address, never a script or data URL", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi"]) {
      const result = parseProductPackage({ maker: { url }, products: [board] });
      expect(!result.ok && result.errors.join(" ")).toMatch(/maker\.url/);
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
});
