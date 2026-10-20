import { colourMaterial, colourWord } from "@/domain/colour-words";
import {
  type ColourOption,
  colourOf,
  type Dimensions,
  dimensionsLabel,
  type Product,
  partLabel,
  productImages,
  reliefLabel,
  type Treatment,
  type ViewLabel,
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
// Where a view looks from, and what it shows that the front cannot.
const VIEW_SHOWS: Record<ViewLabel, string> = {
  side: "from the side: its depth and how far its marks stand from the face",
  top: "from above: its outline and its depth",
  back: "from behind: its back and its depth",
  "three-quarter":
    "at three-quarter: its shape, its depth and how far its marks stand from the face",
};

export function productUnderstanding(
  product: Product,
  // A video animates a start frame and reads no other image, so no image is
  // named to it.
  options: { images?: boolean } = {},
): BaseUnderstanding {
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
  // The images read after the reference (productImages), each named by its
  // place: what it shows, and that nothing else is taken from it.
  const images = options.images === false ? [] : productImages(product);
  const sampleImage = images.find((i) => i.role === "sample");
  const sample = sampleImage
    ? `; its surfaces have exactly the material, colour and grain of the material sample (the ${sampleImage.place} image), and nothing else is taken from that sample (not its shape, framing or edges)`
    : "";
  const views = images
    .filter((i) => i.role !== "sample")
    .map(
      (i) =>
        `; the ${i.role} view (the ${i.place} image) shows this same product ${VIEW_SHOWS[i.role as ViewLabel]}; nothing else is taken from it`,
    )
    .join("");
  // A product of several pieces names each with its size, colour and
  // material, so a scene draws the base as a base, not a thin strip.
  const parts = product.parts ?? [];
  const named = parts.map(
    (p) =>
      `the ${p.name} (${[partLabel(p, product.dimensions.unit), p.colour?.name, p.material].filter(Boolean).join(", ")})`,
  );
  const pieces =
    named.length > 0
      ? `, made of ${named.length} parts: ${named.slice(0, -1).join(", ")} and ${named.at(-1)}; every part true to its size`
      : "";
  // With parts, the product's own size is the whole assembly's.
  const size = `${dimensionsLabel(product.dimensions)}${named.length > 0 ? " overall" : ""}`;
  return {
    subject: `${product.name}: a ${size} ${product.shape} in ${material}${pieces}${wording}; keep every letter, mark and proportion exactly as in the master image${views}${forbidden}`,
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
