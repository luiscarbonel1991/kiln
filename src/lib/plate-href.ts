import type { OutlineBox, Product } from "@/domain/product";
import { isRenderableUrl } from "@/lib/asset-url";

export interface PlateImage {
  href: string;
  // Where the product sits in the image's frame (fractions): the part drawn to
  // the product's size.
  box: OutlineBox;
}

// The product's own plate, for exact frames drawn to scale: a vector
// product's SVG, cropped to the outline Kiln measured at import. Without a
// measured outline (an older import, a drawing that does not match the
// dimensions) and for other products, the frames draw the outline from the
// spec: a photo or an uploaded reference carries a background and would not
// read to scale.
export function plateHref(product: Product): PlateImage | null {
  const source = product.source;
  return source.kind === "vector" &&
    source.outlineBox &&
    isRenderableUrl(source.svgUrl)
    ? { href: source.svgUrl, box: source.outlineBox }
    : null;
}
