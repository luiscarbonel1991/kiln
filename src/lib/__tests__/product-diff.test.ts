import { describe, expect, it } from "vitest";
import { Product } from "@/domain/product";
import { canonicalJson, productChanges } from "@/lib/product-diff";

const before = Product.parse({
  id: "a",
  sku: "PD-01",
  name: "Diff test board",
  family: "Kitchen",
  dimensions: { w: 10, h: 6, unit: "in" },
  shape: "board",
  material: "hardwood",
  treatment: "engraved",
  colours: [
    { key: "oak", name: "Oak", face: "#C8A165" },
    { key: "ash", name: "Ash", face: "#E3D5B8" },
  ],
  defaultColour: "oak",
  typography: { family: "Fraunces" },
  source: { kind: "vector", svgUrl: "http://storage.test/a.svg" },
});

describe("productChanges", () => {
  it("names nothing for the same product, whatever its row id", () => {
    expect(productChanges(before, { ...before, id: "b" })).toEqual([]);
  });

  it("names each changed field in the maker's words", () => {
    const after = {
      ...before,
      material: "solid oak",
      dimensions: { ...before.dimensions, w: 12 },
      source: { kind: "vector" as const, svgUrl: "http://storage.test/b.svg" },
    };
    expect(productChanges(before, after)).toEqual([
      "size",
      "material",
      "reference drawing",
    ]);
    expect(productChanges(before, { ...before, price: 30 })).toEqual(["price"]);
    expect(
      productChanges(before, {
        ...before,
        views: [{ label: "side", url: "http://storage.test/side.png" }],
      }),
    ).toEqual(["reference views"]);
  });

  it("says which colours were added, removed or changed", () => {
    const after = {
      ...before,
      colours: [
        { ...before.colours[0], face: "#B8915A" },
        { key: "walnut", name: "Walnut", face: "#5B3A29", inStock: true },
      ],
    };
    expect(productChanges(before, after)).toEqual([
      "colours (+Walnut, −Ash, Oak changed)",
    ]);
    const sampled = {
      ...before,
      colours: [
        { ...before.colours[0], swatchUrl: "http://storage.test/oak.jpg" },
        before.colours[1],
      ],
    };
    expect(productChanges(before, sampled)).toEqual(["colours (Oak changed)"]);
    const reordered = { ...before, colours: [...before.colours].reverse() };
    expect(productChanges(before, reordered)).toEqual(["colour order"]);
  });
});

describe("canonicalJson", () => {
  it("is the same whatever order the keys were written in", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }),
    );
  });
});
