import type { Product } from "@/domain/product";

// A re-import keeps each colour's material photo that the package does not
// give (DOGFOOD #54). An exporter rarely knows the photos a maker attached in
// Kiln (the form, the HTTP API), and wiping them on every run would undo them,
// now that re-importing is routine. A colour the package gives a `swatchUrl`
// takes the package's; a colour the package drops goes, photo and all. To
// remove a photo: the product page, or DELETE …/colours/:key/swatch.
export function keepSwatches(
  product: Product,
  stored: Product | null | undefined,
): { product: Product; kept: string[] } {
  if (!stored) return { product, kept: [] };
  const before = new Map(stored.colours.map((c) => [c.key, c.swatchUrl]));
  const kept: string[] = [];
  const colours = product.colours.map((c) => {
    const swatchUrl = before.get(c.key);
    if (c.swatchUrl || !swatchUrl) return c;
    kept.push(c.name);
    return { ...c, swatchUrl };
  });
  return kept.length > 0
    ? { product: { ...product, colours }, kept }
    : { product, kept };
}
