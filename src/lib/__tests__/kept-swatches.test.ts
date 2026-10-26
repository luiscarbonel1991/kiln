import { describe, expect, it } from "vitest";
import { Product } from "@/domain/product";
import { keepSwatches } from "@/lib/kept-swatches";

const product = (colours: Record<string, string | undefined>) =>
  Product.parse({
    id: "keep:KS-01",
    sku: "KS-01",
    name: "Keep test coaster",
    family: "Home",
    dimensions: { w: 4, h: 4, unit: "in" },
    shape: "round coaster",
    material: "birch",
    treatment: "engraved",
    colours: Object.entries(colours).map(([key, swatchUrl]) => ({
      key,
      name: key[0].toUpperCase() + key.slice(1),
      face: "#C8A165",
      ...(swatchUrl ? { swatchUrl } : {}),
    })),
    defaultColour: Object.keys(colours)[0],
    typography: { family: "Hanken Grotesk" },
    source: { kind: "form" },
  });

const swatches = (p: Product) =>
  Object.fromEntries(p.colours.map((c) => [c.key, c.swatchUrl]));

describe("keepSwatches", () => {
  it("a re-import keeps the material photos the package does not give, and names them", () => {
    const stored = product({ oak: "s3://oak.jpg", maple: "s3://maple.jpg" });
    const { product: merged, kept } = keepSwatches(
      product({ oak: undefined, maple: undefined, walnut: undefined }),
      stored,
    );
    expect(swatches(merged)).toEqual({
      oak: "s3://oak.jpg",
      maple: "s3://maple.jpg",
      walnut: undefined,
    });
    expect(kept).toEqual(["Oak", "Maple"]);
  });

  it("the package's own photo wins; a colour it drops goes", () => {
    const stored = product({ oak: "s3://oak.jpg", maple: "s3://maple.jpg" });
    const { product: merged, kept } = keepSwatches(
      product({ oak: "s3://oak-new.jpg" }),
      stored,
    );
    expect(swatches(merged)).toEqual({ oak: "s3://oak-new.jpg" });
    expect(kept).toEqual([]);
  });

  it("a new product, or nothing to keep, comes back as it was", () => {
    const incoming = product({ oak: undefined });
    expect(keepSwatches(incoming, null).product).toBe(incoming);
    expect(keepSwatches(incoming, product({ oak: undefined })).product).toBe(
      incoming,
    );
  });
});
