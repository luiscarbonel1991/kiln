import type { Product } from "@/domain/product";
import { isRenderableUrl } from "@/lib/asset-url";

// The product's own plate, for exact frames drawn to scale: a vector
// product's SVG (its bbox is the product's real proportion). Other products
// get their outline drawn from the spec instead: a photo or an uploaded
// reference carries a background and would not read to scale.
export function plateHref(product: Product): string | null {
  return product.source.kind === "vector" &&
    isRenderableUrl(product.source.svgUrl)
    ? product.source.svgUrl
    : null;
}
