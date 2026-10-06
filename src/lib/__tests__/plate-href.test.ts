import { describe, expect, it } from "vitest";
import { Product } from "@/domain/product";
import { plateHref } from "@/lib/plate-href";

const SVG = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

const product = (source: unknown) =>
  Product.parse({
    id: "t:P-1",
    sku: "P-1",
    name: "Coaster",
    family: "Home",
    dimensions: { w: 4, h: 4, unit: "in" },
    shape: "round coaster",
    material: "birch",
    treatment: "engraved",
    colours: [{ key: "n", name: "Natural", face: "#D9B98C" }],
    defaultColour: "n",
    typography: { family: "Hanken Grotesk" },
    source,
  });

describe("plateHref", () => {
  it("a vector product with a measured outline is drawn from its SVG, cropped", () => {
    const box = { x: 0.025, y: 0.025, w: 0.95, h: 0.95 };
    expect(
      plateHref(product({ kind: "vector", svgUrl: SVG, outlineBox: box })),
    ).toEqual({ href: SVG, box });
  });

  it("without a measured outline, or for other sources, the spec's outline is drawn", () => {
    expect(plateHref(product({ kind: "vector", svgUrl: SVG }))).toBeNull();
    expect(plateHref(product({ kind: "form" }))).toBeNull();
    expect(
      plateHref(product({ kind: "photo", assetUrl: "https://x/p.png" })),
    ).toBeNull();
  });
});
