import type { MasterAsset } from "@/domain/master-asset";
import { PlateRequest, type Product } from "@/domain/product";
import { photoReference } from "@/lib/project-start";
import { svgPlateRenderer } from "@/providers/plates/svg";

// The anchor image a product-first project starts from, when Kiln can make one
// for free: the product's photo, or the plate of a vector product rendered
// locally from its SVG (resvg, no model). Catalog and typed-in products get
// none here — the maker adds a reference (a photo or their own plate) on the
// board. Server-only: rendering needs Node and object storage.
export async function productReference(
  product: Product,
): Promise<MasterAsset | null> {
  const photo = photoReference(product);
  if (photo) return photo;
  if (product.source.kind !== "vector") return null;
  try {
    const plate = await svgPlateRenderer.render({
      product,
      request: PlateRequest.parse({
        productId: product.id,
        pieces: [{ colour: product.defaultColour }],
      }),
    });
    return {
      id: `plate-${product.id}`,
      origin: "product",
      sourcePrompt: null,
      assetUrl: plate.assetUrl,
      mime: plate.mime,
    };
  } catch (error) {
    console.warn(`No plate for product ${product.id}:`, error);
    return null;
  }
}
