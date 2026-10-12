import { colourMaterial, colourWord } from "@/domain/colour-words";
import {
  type ColourOption,
  colourOf,
  type Dimensions,
  dimensionsLabel,
  type Product,
  reliefLabel,
  type Treatment,
} from "@/domain/product";
import type { BaseUnderstanding } from "@/domain/understanding";

// What the treatment puts on the face, in the colour of its marks when the
// spec gives one ("white raised elements ...") and with its relief: without
// them a model guesses — a macro once rendered white letters as brushed
// silver, and raised letters flush with the face. The treatment decides how
// the product looks, never the model's default.
const TREATMENT_DETAIL: Record<
  Treatment,
  (ink: string | null, relief: string | null) => string
> = {
  raised: (ink, relief) =>
    `${ink ? `${ink} ` : ""}raised elements standing ${relief ?? "clearly"} proud of the face, their side walls visible, a short soft shadow under each`,
  inlaid: (ink) =>
    `${ink ? `${ink} ` : ""}inlaid elements flush with the face, no relief`,
  engraved: (ink) =>
    `${ink ? `${ink} ` : ""}engraved detail cut into the face and flush with it, a slightly textured engraved surface, no relief above the face`,
  printed: (ink) =>
    `a printed design${ink ? ` in ${ink}` : ""}, flat on the face, no relief`,
  cut: () => "a cut-out silhouette",
};

// What each treatment must never be rendered as: its opposite.
const TREATMENT_AVOID: Record<Treatment, string> = {
  raised: "flat printed lettering, lettering flush with the face",
  inlaid: "raised lettering, shadows under the lettering",
  engraved: "raised lettering, shadows under the lettering",
  printed: "raised lettering, engraved lettering",
  cut: "",
};

function reliefOf(dimensions: Dimensions): string | null {
  return dimensions.relief
    ? reliefLabel(dimensions.relief, dimensions.unit)
    : null;
}

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
  // A material sample travels as the image after the reference (see
  // defaultSwatch): it says what the surfaces look like, never what to draw.
  const sample = colour.swatchUrl
    ? "; its surfaces have exactly the material, colour and grain of the material sample (the second image), and nothing else is taken from that sample (not its shape, framing or edges)"
    : "";
  return {
    subject: `${product.name}: a ${dimensionsLabel(product.dimensions)} ${product.shape} in ${material}${wording}; keep every letter, mark and proportion exactly as in the master image${forbidden}`,
    productType: `${product.family.toLowerCase()}, ${product.shape}`,
    useContext: product.useContexts[0] ?? "",
    sceneProps: "",
    materials: `${material}, ${TREATMENT_DETAIL[product.treatment](inkOf(colour), reliefOf(product.dimensions))}${sample}`,
    avoid: TREATMENT_AVOID[product.treatment],
    lighting: "soft natural light",
    composition: "the product centered, filling most of the frame",
    mood: "clean and true to the product",
    palette: [colour.face, ...(colour.inlay ? [colour.inlay] : [])],
  };
}
