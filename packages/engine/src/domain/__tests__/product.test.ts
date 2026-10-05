import { describe, expect, it } from "vitest";
import {
  PlateRequest,
  PlateResult,
  Product,
  validateWording,
} from "@/domain/product";

// A generic catalog product with wording (no maker's catalog in the engine's
// fixtures: Kiln must build and test without any of them).
const keyFob = Product.parse({
  id: "example:KF-01",
  sku: "KF-01",
  name: "Engraved key fob",
  family: "Key fob",
  dimensions: { w: 3, h: 1.25, d: 0.25, unit: "in" },
  shape: "rounded rectangle",
  material: "solid hardwood",
  treatment: "engraved",
  colours: [
    { key: "oak", name: "Oak", face: "#C8A165" },
    { key: "walnut", name: "Walnut", face: "#5B3A29" },
  ],
  defaultColour: "walnut",
  typography: { family: "Hanken Grotesk", weight: 600, case: "upper" },
  wording: [
    { label: "Name", maxChars: 6, required: false, example: "HOME" },
    { label: "Initials", maxChars: 3, required: true, example: "AMB" },
  ],
  icons: [],
  variants: [
    {
      name: "Set",
      values: [
        { key: "1", label: "Single" },
        { key: "3", label: "Set of 3", priceExtra: 12 },
      ],
    },
  ],
  source: { kind: "catalog", adapterId: "example-catalog", ref: "KF-01" },
});

describe("Product", () => {
  it("parses a catalog product with defaults", () => {
    expect(keyFob.forbidden).toContain("other text");
    expect(keyFob.colours[0].inStock).toBe(true);
    expect(keyFob.dimensions.unit).toBe("in");
  });

  it("rejects a bad hex colour", () => {
    expect(() =>
      Product.parse({
        ...keyFob,
        colours: [{ key: "x", name: "X", face: "green" }],
      }),
    ).toThrow();
  });
});

describe("validateWording", () => {
  it("accepts a valid piece", () => {
    expect(
      validateWording(keyFob, [{ colour: "walnut", wording: ["HOME", "AMB"] }]),
    ).toEqual([]);
  });

  it("flags too many characters, a missing required line and an unknown colour", () => {
    const problems = validateWording(keyFob, [
      { colour: "gold", wording: ["STUDIO7", ""] },
    ]);
    expect(problems.some((p) => p.includes("max 6"))).toBe(true);
    expect(problems.some((p) => p.includes("is required"))).toBe(true);
    expect(problems.some((p) => p.includes("not offered"))).toBe(true);
  });
});

describe("PlateRequest / PlateResult", () => {
  it("defaults to one 1024 px plate without a baked shadow", () => {
    const req = PlateRequest.parse({
      productId: "example:KF-01",
      pieces: [{ colour: "walnut", wording: ["HOME", "AMB"] }],
    });
    expect(req.sizePx).toBe(1024);
    expect(req.shadow).toBe(false);
    expect(req.layout).toBe("single");
  });

  it("carries the QC hints", () => {
    const res = PlateResult.parse({
      productId: "example:KF-01",
      assetUrl: "http://localhost:9000/kiln-assets/plates/x.png",
      sizePx: 1024,
      ppi: 120,
      pieces: [
        {
          bbox: { x: 212, y: 362, w: 600, h: 250 },
          expectedText: ["HOME", "AMB"],
          colour: "walnut",
        },
      ],
      renderer: { id: "example-catalog", version: "1" },
      request: {
        productId: "example:KF-01",
        pieces: [{ colour: "walnut", wording: ["HOME", "AMB"] }],
      },
    });
    expect(res.mime).toBe("image/png");
    expect(res.pieces[0].expectedText).toEqual(["HOME", "AMB"]);
  });
});
