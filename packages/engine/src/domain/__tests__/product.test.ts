import { describe, expect, it } from "vitest";
import {
  PlateRequest,
  PlateResult,
  Product,
  productPromptFields,
  validateWording,
} from "@/domain/product";

const unitPlaque = Product.parse({
  id: "maker1:UN-01",
  sku: "UN-01",
  name: "Unit number plaque",
  family: "Unit number",
  dimensions: { w: 5, h: 2.5, d: 0.25, unit: "in" },
  shape: "rounded rectangle",
  material: "matte cast acrylic",
  treatment: "raised",
  colours: [
    { key: "sage", name: "Dark Sage Green", face: "#4B5F50", inlay: "#FEFEFD" },
    { key: "charcoal", name: "Black Matte", face: "#171311", inlay: "#FEFEFD" },
  ],
  defaultColour: "charcoal",
  typography: {
    family: "Plus Jakarta Sans",
    weight: 600,
    case: "upper",
    tracking: 5,
  },
  wording: [
    { label: "Word above", maxChars: 6, required: false, example: "UNIT" },
    { label: "Number", maxChars: 4, required: true, example: "204" },
  ],
  icons: [],
  variants: [
    {
      name: "Set",
      values: [
        { key: "1", label: "Single" },
        { key: "5", label: "Set of 5", priceExtra: 27 },
      ],
    },
  ],
  source: {
    kind: "catalog",
    adapterId: "maker1-matte-acrylic-signs",
    ref: "UN-01",
  },
});

describe("Product", () => {
  it("parses a catalog product with defaults", () => {
    expect(unitPlaque.forbidden).toContain("other text");
    expect(unitPlaque.colours[0].inStock).toBe(true);
    expect(unitPlaque.dimensions.unit).toBe("in");
  });

  it("rejects a bad hex colour", () => {
    expect(() =>
      Product.parse({
        ...unitPlaque,
        colours: [{ key: "x", name: "X", face: "green" }],
      }),
    ).toThrow();
  });
});

describe("validateWording", () => {
  it("accepts a valid piece", () => {
    expect(
      validateWording(unitPlaque, [
        { colour: "charcoal", wording: ["UNIT", "204"] },
      ]),
    ).toEqual([]);
  });

  it("flags too many characters, a missing required line and an unknown colour", () => {
    const problems = validateWording(unitPlaque, [
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
      productId: "maker1:UN-01",
      pieces: [{ colour: "charcoal", wording: ["UNIT", "204"] }],
    });
    expect(req.sizePx).toBe(1024);
    expect(req.shadow).toBe(false);
    expect(req.layout).toBe("single");
  });

  it("carries the QC hints", () => {
    const res = PlateResult.parse({
      productId: "maker1:UN-01",
      assetUrl: "http://localhost:9000/kiln-assets/plates/x.png",
      sizePx: 1024,
      ppi: 120,
      pieces: [
        {
          bbox: { x: 212, y: 362, w: 600, h: 300 },
          expectedText: ["UNIT", "204"],
          colour: "charcoal",
        },
      ],
      renderer: { id: "maker1-matte-acrylic-signs", version: "1" },
      request: {
        productId: "maker1:UN-01",
        pieces: [{ colour: "charcoal", wording: ["UNIT", "204"] }],
      },
    });
    expect(res.mime).toBe("image/png");
    expect(res.pieces[0].expectedText).toEqual(["UNIT", "204"]);
  });
});

describe("productPromptFields", () => {
  it("quotes the wording verbatim and keeps the exactness clause", () => {
    const { subject, materials } = productPromptFields(
      unitPlaque,
      PlateRequest.parse({
        productId: "maker1:UN-01",
        pieces: [{ colour: "charcoal", wording: ["UNIT", "204"] }],
      }),
    );
    expect(subject).toContain('"UNIT" over "204"');
    expect(subject).toContain("5 x 2.50 in");
    expect(subject).toContain("keep every letter");
    expect(subject).toContain("exactly one piece");
    expect(subject).toContain("no other text");
    expect(materials).toContain("black matte cast acrylic, zero gloss");
    expect(subject).toContain("unit number sign of black matte cast acrylic");
    expect(materials).toContain("raised 1/8 inch");
  });

  it("describes several pieces with their own wording", () => {
    const { subject } = productPromptFields(
      unitPlaque,
      PlateRequest.parse({
        productId: "maker1:UN-01",
        layout: "row",
        pieces: [
          { colour: "sage", wording: ["", "01"] },
          { colour: "sage", wording: ["", "02"] },
        ],
      }),
    );
    expect(subject).toContain("2 identical");
    expect(subject).toContain('piece 1: the words "01"');
    expect(subject).toContain("exactly 2 pieces");
  });
});
