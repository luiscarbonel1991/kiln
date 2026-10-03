import {
  colourOf,
  dimensionsLabel,
  type Product,
  type Treatment,
} from "@/domain/product";
import type { BaseUnderstanding } from "@/domain/understanding";

const TREATMENT_DETAIL: Record<Treatment, string> = {
  raised: "raised elements on the face",
  inlaid: "inlaid elements flush with the face",
  engraved: "engraved detail",
  printed: "a printed design",
  cut: "a cut-out silhouette",
};

// The studio's "image" layer for a product-first project: what the vision call
// would have extracted from a photo, written from the spec instead (no paid
// call). Generic for any maker; the default colour and the wording examples
// stand in for a buyer's choice until the project asks for one.
export function productUnderstanding(product: Product): BaseUnderstanding {
  const colour = colourOf(product, product.defaultColour);
  const examples = product.wording
    .map((w) => w.example?.trim())
    .filter((e): e is string => !!e);
  const wording =
    examples.length > 0
      ? `, with the wording ${examples.map((e) => `"${e}"`).join(" and ")} in ${product.typography.family}`
      : "";
  const forbidden =
    product.forbidden.length > 0
      ? `; no ${product.forbidden.join(", no ")}`
      : "";
  return {
    subject: `${product.name}: a ${dimensionsLabel(product.dimensions)} ${product.shape} in ${colour.name.toLowerCase()} ${product.material}${wording}; keep every letter, mark and proportion exactly as in the master image${forbidden}`,
    productType: `${product.family.toLowerCase()}, ${product.shape}`,
    useContext: "",
    sceneProps: "",
    materials: `${colour.name.toLowerCase()} ${product.material}, ${TREATMENT_DETAIL[product.treatment]}`,
    lighting: "soft natural light",
    composition: "the product centered, filling most of the frame",
    mood: "clean and true to the product",
    palette: [colour.face, ...(colour.inlay ? [colour.inlay] : [])],
  };
}
