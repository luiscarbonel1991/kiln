import type { MasterAsset } from "@/domain/master-asset";
import { PlateRequest, type Product } from "@/domain/product";
import type { ThreeQuarterView } from "@/domain/scene-reference";
import { photoReference } from "@/lib/project-start";
import { svgPlateRenderer } from "@/providers/plates/svg";
import { renderThreeQuarter } from "@/providers/plates/three-quarter";

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

// The product seen from a little above, drawn beside the plate Kiln made for
// it (free, local): only for a vector product whose parts stand as a piece
// upright on a part lying flat (three-quarter.ts says why not, and null is
// the answer). A photo or a maker's own reference gets none.
export async function threeQuarterReference(
  product: Product,
  front: MasterAsset | null,
): Promise<ThreeQuarterView | null> {
  if (!front || front.id !== `plate-${product.id}`) return null;
  try {
    const view = await renderThreeQuarter(product);
    return view
      ? {
          assetUrl: view.assetUrl,
          angleDeg: view.angleDeg,
          front: front.assetUrl,
        }
      : null;
  } catch (error) {
    console.warn(`No view from above for product ${product.id}:`, error);
    return null;
  }
}
