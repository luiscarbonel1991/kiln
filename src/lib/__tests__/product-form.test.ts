import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProductPackage } from "@/domain/product-package";
import {
  colourName,
  ProductForm,
  productFromForm,
  skuFor,
  svgColours,
} from "@/lib/product-form";

const form: ProductForm = {
  name: "Botanical round coaster",
  whatItIs: "round coaster",
  width: 4,
  height: 4,
  unit: "in",
  material: "birch plywood",
  treatment: "engraved",
  colours: [
    { name: "Natural", hex: "#d9b98c" },
    { name: "Natural", hex: "#5B3A29" },
  ],
  wording: [{ label: "Initials", example: "A & J" }],
  useContexts: ["a coffee table"],
  views: [],
};

describe("product form", () => {
  it("fills what the maker did not type: sku, keys, default colour, family, typography", () => {
    const product = productFromForm(form, "7k2");
    expect(product).toMatchObject({
      id: "botanical-round-coaster-7k2",
      sku: "botanical-round-coaster-7k2",
      family: "General",
      shape: "round coaster",
      dimensions: { w: 4, h: 4, unit: "in" },
      colours: [
        { key: "natural", name: "Natural", face: "#D9B98C" },
        { key: "natural-2", name: "Natural", face: "#5B3A29" },
      ],
      defaultColour: "natural",
      typography: { family: "Hanken Grotesk" },
      wording: [{ label: "Initials", maxChars: null, example: "A & J" }],
      useContexts: ["a coffee table"],
      source: { kind: "form" },
    });
  });

  it("keeps a line's most characters and whether the buyer may skip it", () => {
    const product = productFromForm(
      {
        ...form,
        wording: [
          { label: "Name", example: "Sofia", maxChars: 12 },
          { label: "Date", example: "06.14.2026", required: false },
        ],
      },
      "7k2",
    );
    expect(product.wording).toEqual([
      { label: "Name", example: "Sofia", maxChars: 12, required: true },
      { label: "Date", example: "06.14.2026", maxChars: null, required: false },
    ]);
  });

  it("refuses an example longer than its line allows, at the example", () => {
    const parsed = ProductForm.safeParse({
      ...form,
      wording: [{ label: "Name", example: "Alexandria", maxChars: 6 }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].path).toEqual(["wording", 0, "example"]);
  });

  it("keeps several places, the default colour and the more details", () => {
    const product = productFromForm(
      {
        ...form,
        useContexts: ["a coffee table", "a reading nook"],
        defaultColour: 1,
        depth: 0.25,
        relief: 0.04,
        hook: "Coffee, on the table.",
        cta: "Order yours",
        description: "Cut from one sheet.",
      },
      "7k2",
    );
    expect(product).toMatchObject({
      useContexts: ["a coffee table", "a reading nook"],
      defaultColour: "natural-2",
      dimensions: { w: 4, h: 4, d: 0.25, relief: 0.04, unit: "in" },
      hook: "Coffee, on the table.",
      cta: "Order yours",
      description: "Cut from one sheet.",
    });
  });

  it("refuses a default colour that is not one of its rows", () => {
    expect(ProductForm.safeParse({ ...form, defaultColour: 2 }).success).toBe(
      false,
    );
  });

  it("keeps the maker's price when given", () => {
    expect(productFromForm({ ...form, price: 24 }, "7k2").price).toBe(24);
    expect(productFromForm(form, "7k2")).not.toHaveProperty("price");
  });

  it("a layered finish needs each colour's base, kept as its inlay", () => {
    const layered = { ...form, treatment: "reveal" as const };
    const missing = ProductForm.safeParse(layered);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]).toMatchObject({
      path: ["colours", 0, "base"],
      message: "Pick the colour that shows through the cuts.",
    });
    const product = productFromForm(
      {
        ...layered,
        colours: [
          { ...form.colours[0], base: "#1f1f1f" },
          { ...form.colours[1], base: "#ffffff" },
        ],
      },
      "7k2",
    );
    expect(product.treatment).toBe("reveal");
    expect(product.colours.map((c) => c.inlay)).toEqual(["#1F1F1F", "#FFFFFF"]);
  });

  it("keeps a colour's material photo", () => {
    const product = productFromForm(
      {
        ...form,
        colours: [
          {
            ...form.colours[0],
            swatchUrl: "http://storage.test/products/oak.jpg",
          },
          form.colours[1],
        ],
      },
      "7k2",
    );
    expect(product.colours[0].swatchUrl).toBe(
      "http://storage.test/products/oak.jpg",
    );
    expect(product.colours[1]).not.toHaveProperty("swatchUrl");
  });

  it("keeps a colour's supplier page, and only a web address", () => {
    const withLink = (supplierUrl: string) => ({
      ...form,
      colours: [{ ...form.colours[0], supplierUrl }, form.colours[1]],
    });
    const product = productFromForm(
      withLink("https://supplier.example/birch"),
      "7k2",
    );
    expect(product.colours[0].supplierUrl).toBe(
      "https://supplier.example/birch",
    );
    expect(product.colours[1]).not.toHaveProperty("supplierUrl");
    const refused = ProductForm.safeParse(withLink("javascript:alert(1)"));
    expect(refused.error?.issues[0]).toMatchObject({
      path: ["colours", 0, "supplierUrl"],
      message: "Paste the supplier's page, starting with https://.",
    });
  });

  it("a photo becomes the reference; an SVG the plate, its scale from the width", () => {
    expect(
      productFromForm(
        { ...form, file: { kind: "photo", url: "https://s/p.png" } },
        "a",
      ).source,
    ).toEqual({ kind: "photo", assetUrl: "https://s/p.png" });
    expect(
      productFromForm(
        {
          ...form,
          file: { kind: "vector", url: "https://s/d.svg", drawnWidthPx: 400 },
        },
        "a",
      ).source,
    ).toEqual({
      kind: "vector",
      svgUrl: "https://s/d.svg",
      scalePxPerUnit: 100,
    });
  });

  it("refuses what it cannot make a product from, in plain words", () => {
    expect(() => productFromForm({ ...form, name: " " }, "a")).toThrow(
      "Name the product.",
    );
    expect(() => productFromForm({ ...form, colours: [] }, "a")).toThrow(
      "Add at least one colour.",
    );
  });

  it("names skus and colours readably", () => {
    expect(skuFor("Señal ¡Bienvenidos! 2026", "x1")).toBe(
      "senal-bienvenidos-2026-x1",
    );
    expect(colourName("#111111")).toBe("Black");
    // A near-black grey is black, never "dark brown".
    expect(colourName("#262627")).toBe("Black");
    expect(colourName("#787674")).toBe("Grey");
    expect(colourName("#D9C5A0")).toBe("Beige");
  });
});

describe("svgColours", () => {
  it("reads fills, strokes and gradient stops, most used first", () => {
    const svg = `<svg viewBox="0 0 10 10"><path fill="#5b3a29"/><path fill="#5B3A29"/><circle style="fill:#fff;stroke:#D9B98C"/><stop stop-color="#d9b98c"/><rect fill="none"/></svg>`;
    expect(svgColours(svg)).toEqual(["#5B3A29", "#D9B98C", "#FFFFFF"]);
    expect(svgColours("<svg/>")).toEqual([]);
  });
});

describe("product packages", () => {
  it("refuses a default colour that is not one of the product's colours", () => {
    const product = productFromForm(form, "a");
    const result = parseProductPackage({ ...product, defaultColour: "oak" });
    expect(result.ok && result.products).toEqual([]);
    expect(result.ok && result.rejected[0].errors).toEqual([
      'defaultColour "oak" is not one of its colours (natural, natural-2)',
    ]);
  });

  it("the downloadable template is a valid package", () => {
    const template = JSON.parse(
      readFileSync(
        join(process.cwd(), "public/templates/product-package.json"),
        "utf8",
      ),
    );
    const result = parseProductPackage(template);
    expect(result.ok && result.rejected).toEqual([]);
  });
});
