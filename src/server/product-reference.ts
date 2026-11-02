import type { MasterAsset } from "@/domain/master-asset";
import type { ProjectPlan } from "@/domain/plan";
import { drawnLooks } from "@/domain/plan-look";
import { colourOf, PlateRequest, type Product } from "@/domain/product";
import {
  productInLook,
  productStyles,
  type ResolvedLook,
  resolveLook,
  sameLook,
  storedLook,
} from "@/domain/product-look";
import { drawnIn, recolourSvg } from "@/domain/recolour";
import type { LookReference } from "@/domain/scene-reference";
import { photoReference } from "@/lib/project-start";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { svgPlateRenderer } from "@/providers/plates/svg";
import { renderThreeQuarter } from "@/providers/plates/three-quarter";

export type DrawnLook = LookReference | { refused: string };

const NO_DESIGN =
  "Kiln draws other colours and styles from a design file; this product has none.";

// A look's design, free (ROADMAP P2-9): its style's drawing or the product's
// own, redrawn in the look's colour and stored by its bytes (the same look
// is the same file). Refused, with why, for a product not drawn from an SVG
// and for a colour Kiln cannot swap in: a drawing that paints none of the
// product's colours is taken as it is, in the default colour only.
export async function lookDesign(
  product: Product,
  look: ResolvedLook,
): Promise<{ design: string } | { refused: string }> {
  if (product.source.kind !== "vector") return { refused: NO_DESIGN };
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
    return {
      design:
        from && from.key !== look.colour
          ? await storeAsset(
              Buffer.from(recolourSvg(svg, from, target), "utf8"),
              "image/svg+xml",
              "products",
              { byContent: true },
            )
          : url,
    };
  } catch (error) {
    return {
      refused: `Kiln could not draw ${target.name}: ${(error as Error).message}`,
    };
  }
}

// A look drawn by Kiln, free and local: its design, its plate, and its view
// from above when the product stands so.
export async function drawLook(
  product: Product,
  look: ResolvedLook,
): Promise<DrawnLook> {
  const drawing = await lookDesign(product, look);
  if ("refused" in drawing) return drawing;
  const { design } = drawing;
  const shown = productInLook(product, look, design);
  try {
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
      refused: `Kiln could not draw ${colourOf(product, look.colour).name}: ${(error as Error).message}`,
    };
  }
}

// The anchor image a product-first project starts from, in the project's
// look, when Kiln can make one for free: the product's photo, or the look
// Kiln draws for a vector product (its plate as the reference, its view from
// above, and the drawing the plan keeps). Catalog and typed-in products get
// none here: the maker adds a reference (a photo or their own plate) on the
// board. Server-only: rendering needs Node and object storage.
export async function lookedReference(
  product: Product,
  look: ResolvedLook,
): Promise<{
  master: MasterAsset | null;
  drawn: LookReference | null;
  refused?: string;
}> {
  const photo = photoReference(product);
  if (photo) return { master: photo, drawn: null };
  if (product.source.kind !== "vector") return { master: null, drawn: null };
  const drawn = await drawLook(product, look);
  if ("refused" in drawn) {
    console.warn(`No plate for product ${product.id}: ${drawn.refused}`);
    return { master: null, drawn: null, refused: drawn.refused };
  }
  return {
    master: {
      id: `plate-${product.id}`,
      origin: "product",
      sourcePrompt: null,
      assetUrl: drawn.front,
      mime: "image/png",
    },
    drawn,
  };
}

// Every other look the plan keeps, drawn again from the product as it is
// now (after an update). A look the product no longer offers, or that no
// longer draws, is left out: its frames show the project's look.
export async function redrawnLooks(
  product: Product,
  plan: ProjectPlan,
  except: ResolvedLook,
): Promise<LookReference[]> {
  const looks = drawnLooks(plan).filter(
    (look) =>
      !sameLook(look, except) &&
      sameLook(resolveLook(product, storedLook(look)), look),
  );
  const drawn = await Promise.all(looks.map((look) => drawLook(product, look)));
  return drawn.filter((d): d is LookReference => !("refused" in d));
}
