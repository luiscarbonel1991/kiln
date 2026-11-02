import type { MasterAsset } from "@/domain/master-asset";
import { colourOf, PlateRequest, type Product } from "@/domain/product";
import {
  productInLook,
  productStyles,
  type ResolvedLook,
} from "@/domain/product-look";
import { drawnIn, recolourSvg } from "@/domain/recolour";
import type { LookReference, ThreeQuarterView } from "@/domain/scene-reference";
import { photoReference } from "@/lib/project-start";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { svgPlateRenderer } from "@/providers/plates/svg";
import { renderThreeQuarter } from "@/providers/plates/three-quarter";

export type DrawnLook = LookReference | { refused: string };

// A look drawn by Kiln, free and local (ROADMAP P2-9): the look's design
// (its style's or the product's own) redrawn in its colour and stored by its
// bytes, its plate, and its view from above when the product stands so.
// Refused, with why, for a product not drawn from an SVG, and for a colour
// Kiln cannot swap in: a drawing that paints none of the product's colours
// is drawn as it is in the default colour only.
export async function drawLook(
  product: Product,
  look: ResolvedLook,
): Promise<DrawnLook> {
  if (product.source.kind !== "vector") {
    return {
      refused:
        "Kiln draws other colours and styles from a design file; this product has none.",
    };
  }
  const style = look.style
    ? productStyles(product).find((s) => s.key === look.style)
    : undefined;
  const target = colourOf(product, look.colour);
  try {
    const url = style?.svgUrl ?? product.source.svgUrl;
    const svg = (await fetchAsset(url)).bytes.toString("utf8");
    const from = drawnIn(svg, product);
    if (!from && look.colour !== product.defaultColour) {
      return {
        refused: `Kiln cannot redraw ${style ? `the ${style.name} design` : "this design"} in ${target.name}: its drawing paints none of the product's colours.`,
      };
    }
    const design =
      from && from.key !== look.colour
        ? await storeAsset(
            Buffer.from(recolourSvg(svg, from, target), "utf8"),
            "image/svg+xml",
            "products",
            { byContent: true },
          )
        : url;
    const shown = productInLook(product, look, design);
    const plate = await svgPlateRenderer.render({
      product: shown,
      request: PlateRequest.parse({
        productId: product.id,
        pieces: [{ colour: look.colour }],
      }),
    });
    const view = await renderThreeQuarter(shown).catch((error) => {
      console.warn(`No view from above for product ${product.id}:`, error);
      return null;
    });
    return {
      colour: look.colour,
      ...(look.style ? { style: look.style } : {}),
      design,
      front: plate.assetUrl,
      ...(view
        ? {
            threeQuarter: {
              assetUrl: view.assetUrl,
              angleDeg: view.angleDeg,
              front: plate.assetUrl,
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      refused: `Kiln could not draw ${target.name}: ${(error as Error).message}`,
    };
  }
}

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
