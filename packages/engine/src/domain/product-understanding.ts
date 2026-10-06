import { colourMaterial, colourWord } from "@/domain/colour-words";
import {
  type ColourOption,
  colourOf,
  dimensionsLabel,
  type Product,
  type Treatment,
} from "@/domain/product";
import type { BaseUnderstanding } from "@/domain/understanding";

// What the treatment puts on the face, in the colour of its marks when the
// spec gives one ("white raised elements on the face"): without it a model
// guesses, and a macro once rendered white letters as brushed silver.
const TREATMENT_DETAIL: Record<Treatment, (ink: string | null) => string> = {
  raised: (ink) => `${ink ? `${ink} ` : ""}raised elements on the face`,
  inlaid: (ink) => `${ink ? `${ink} ` : ""}inlaid elements flush with the face`,
  engraved: (ink) => `engraved detail${ink ? ` in ${ink}` : ""}`,
  printed: (ink) => `a printed design${ink ? ` in ${ink}` : ""}`,
  cut: () => "a cut-out silhouette",
};

function inkOf(colour: ColourOption): string | null {
  if (colour.inlayName) return colour.inlayName.toLowerCase();
  return colour.inlay ? colourWord(colour.inlay) : null;
}

// The studio's "image" layer for a product-first project: what the vision call
// would have extracted from a photo, written from the spec instead (no paid
// call). Generic for any maker; the default colour and the wording examples
// stand in for a buyer's choice until the project asks for one.
export function productUnderstanding(product: Product): BaseUnderstanding {
  const colour = colourOf(product, product.defaultColour);
  const material = colourMaterial(colour.name, product.material);
  const examples = product.wording
    .map((w) => w.example?.trim())
    .filter((e): e is string => !!e);
  const wording =
    examples.length > 0
      ? `, with the wording ${examples.map((e) => `"${e}"`).join(" and ")} in ${product.typography.family}`
      : "";
  // The forbidden list is about the product itself; the scene around it may
  // hold the props a slot calls for (a mug on a coaster, a hand, packaging).
  const forbidden =
    product.forbidden.length > 0
      ? `; add nothing to the product itself (no ${product.forbidden.join(", no ")})`
      : "";
  return {
    subject: `${product.name}: a ${dimensionsLabel(product.dimensions)} ${product.shape} in ${material}${wording}; keep every letter, mark and proportion exactly as in the master image${forbidden}`,
    productType: `${product.family.toLowerCase()}, ${product.shape}`,
    useContext: product.useContexts[0] ?? "",
    sceneProps: "",
    materials: `${material}, ${TREATMENT_DETAIL[product.treatment](inkOf(colour))}`,
    lighting: "soft natural light",
    composition: "the product centered, filling most of the frame",
    mood: "clean and true to the product",
    palette: [colour.face, ...(colour.inlay ? [colour.inlay] : [])],
  };
}
