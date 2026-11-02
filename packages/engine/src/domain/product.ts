import { z } from "zod";

// Product-first model (ROADMAP Phase 8). The truth of a customizable physical
// product is its spec, not a photo: dimensions, material, colour set, typography,
// treatment and the wording the buyer types. A PlateRenderer turns (product,
// request) into an exact reference image; the prompt fields are templated from
// the same data so nobody hand-writes SUBJECT / MATERIALS again.

export const Hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "hex colour like #4B5F50");

export const Unit = z.enum(["in", "mm"]);
export type Unit = z.infer<typeof Unit>;

export const Dimensions = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
  d: z.number().positive().optional(),
  // How far raised elements stand proud of the face, or how deep an engraving
  // goes, in the same unit. Prompts name it ("1/8 in"): a frontal plate cannot
  // show relief, so the words have to.
  relief: z.number().positive().optional(),
  unit: Unit.default("in"),
});
export type Dimensions = z.infer<typeof Dimensions>;

// One piece of a product made of several (a plate and the base it stands in):
// its size in the product's unit — w across, h up, d front to back — whether
// it stands upright (its face toward the camera) or lies flat, and its own
// material and a fixed colour when they differ from the product's (a base
// always black, whatever colour the plate), and how round its corners are seen
// from above (a pill-shaped base). The first part is the main one: what the
// buyer chooses and personalizes.
export const ProductPart = z
  .object({
    name: z.string().trim().min(1).max(40),
    dimensions: z.object({
      w: z.number().positive(),
      h: z.number().positive(),
      d: z.number().positive(),
    }),
    lies: z.enum(["upright", "flat"]).default("upright"),
    material: z.string().trim().min(1).max(120).optional(),
    colour: z
      .object({ name: z.string().trim().min(1).max(40), hex: Hex })
      .optional(),
    corner: z
      .number()
      .positive()
      .describe(
        "The radius of its corners seen from above, in the product's unit; half its depth rounds its ends fully. Absent: square corners.",
      )
      .optional(),
  })
  .refine(
    (p) =>
      p.corner === undefined ||
      p.corner <= Math.min(p.dimensions.w, p.dimensions.d) / 2,
    { path: ["corner"], message: "at most half its width or depth" },
  );
export type ProductPart = z.infer<typeof ProductPart>;

// Another view of the product, beside the front one the reference shows: the
// side (how far marks stand out, how deep it is), the top (a base's
// footprint), the back, or three-quarter. A PNG, JPEG or WebP; an SVG
// drawing is rendered to PNG at import. It travels with the reference.
export const ViewLabel = z.enum(["side", "top", "back", "three-quarter"]);
export type ViewLabel = z.infer<typeof ViewLabel>;

export const ProductView = z.object({
  label: ViewLabel,
  url: z
    .string()
    .min(1)
    .describe(
      "An image of the product from this side (PNG, JPEG or WebP, or an SVG drawing rendered at import): a data: image, Kiln's storage or an origin in KILN_ASSET_ORIGINS.",
    ),
});
export type ProductView = z.infer<typeof ProductView>;

// One sellable finish. `face` is what the camera sees; `inlay` is the contrast
// colour of the lettering or marks on that face (white on dark, black on
// light), and in a layered build (`reveal`) the base layer that shows through
// the cuts; `inlayName` names it for prompts ("white"), else the nearest plain
// colour word is used. `swatchUrl` is a sample of the material in this colour
// — a close photo or a tileable texture, even light, no text — that travels
// with the reference to the image model: a flat colour fill reads as paper or
// plastic, and a real photo carries the grain better than a drawn texture.
// `supplierUrl` is the supplier's page for this colour; with a sample, it is
// what makes the colour's look verified (`lookVerified`).
// `productName`, `material` and `forbidden` are the product's own text in
// this colour, for a product whose text names its colours ("engraved black
// & white", "no gold finish"): a scene in this colour reads them in place of
// the product's (productInLook), so it never says two colours at once.
export const ColourOption = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  face: Hex,
  edge: Hex.optional(),
  inlay: Hex.optional(),
  inlayName: z.string().trim().min(1).max(40).optional(),
  swatchUrl: z
    .string()
    .min(1)
    .describe(
      "A close photo of the material in this colour (PNG, JPEG or WebP; even light, no text): a data: image, Kiln's storage or an origin in KILN_ASSET_ORIGINS. It travels with the reference to the image model.",
    )
    .optional(),
  supplierUrl: z
    .string()
    .describe(
      "The supplier's page for this colour (http or https). Kiln never opens it: the maker does, to compare it with the scenes.",
    )
    .optional(),
  productName: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The product's name in this colour, when its own name names another colour (\"Desk name plate, engraved brushed gold\"). Scenes in this colour read it in place of the product's name.",
    )
    .optional(),
  material: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The material in this colour, when the product's material names another colour (\"a satin brushed GOLD surface; the lettering reads matte BLACK\"). Scenes in this colour read it in place of the product's material.",
    )
    .optional(),
  forbidden: z
    .array(z.string().trim().min(1))
    .describe(
      "What scenes in this colour must never show, in place of the product's list (the product's may forbid this colour's finish).",
    )
    .optional(),
  inStock: z.boolean().default(true),
});
export type ColourOption = z.infer<typeof ColourOption>;

export const Typography = z.object({
  family: z.string().min(1),
  weight: z.number().int().min(100).max(900).default(600),
  case: z.enum(["upper", "title", "free"]).default("upper"),
  tracking: z.number().default(0),
});
export type Typography = z.infer<typeof Typography>;

// How the marks are made. `reveal` is a layered build: the marks are cut
// through a top layer (the colour's face) down to a base of another colour
// (its inlay), the relief being the top layer's thickness. `letters` has no
// face at all: each letter and digit of the wording is its own piece, fixed
// straight on the surface it is sold for, `d` its thickness and the relief
// how far it stands off that surface (DOGFOOD #85: a template that assumed a
// panel drew one behind them).
export const Treatment = z.enum([
  "raised",
  "inlaid",
  "engraved",
  "printed",
  "cut",
  "reveal",
  "letters",
]);
export type Treatment = z.infer<typeof Treatment>;

// One line the buyer fills in. `maxChars: null` = the renderer auto-fits.
export const WordingLine = z.object({
  label: z.string().min(1),
  maxChars: z.number().int().positive().nullable(),
  required: z.boolean().default(true),
  example: z.string().optional(),
});
export type WordingLine = z.infer<typeof WordingLine>;

export const IconPlacement = z.enum(["left", "right", "top", "below", "none"]);

export const ProductIcon = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  placement: IconPlacement.default("none"),
});
export type ProductIcon = z.infer<typeof ProductIcon>;

export const VariantValue = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  priceExtra: z.number().default(0),
});

export const VariantAxis = z.object({
  name: z.string().min(1),
  values: z.array(VariantValue).min(1),
});
export type VariantAxis = z.infer<typeof VariantAxis>;

// Where a vector product's outline sits in its SVG's frame (the viewBox), as
// fractions of that frame. Kiln measures it at import (a package's own value
// is never kept), so exact frames draw the product to scale whatever margin
// the drawing carries around it.
export const OutlineBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().positive().max(1),
  h: z.number().positive().max(1),
});
export type OutlineBox = z.infer<typeof OutlineBox>;

// Another design of the same product (the same size, material and colours):
// its own drawing and the wording it shows ("Do not disturb" beside "Quiet
// please"), the wording side of the variant matrix every shop has. Only a
// vector product has styles; its own drawing is the first, named
// `styleName`. Kiln measures each drawing's outline at import, as it does the
// source's, and redraws it in each colour.
export const ProductStyle = z.object({
  // "original" names the product's own drawing (product-look.ts).
  key: z
    .string()
    .min(1)
    .max(64)
    .refine((k) => k !== "original", {
      message: '"original" is the product\'s own drawing: pick another key',
    }),
  name: z.string().trim().min(1).max(40),
  svgUrl: z
    .string()
    .min(1)
    .describe(
      "This design's SVG, drawn in one of the product's colours: a data: image, Kiln's storage or an origin in KILN_ASSET_ORIGINS. Kiln redraws it in each colour.",
    ),
  outlineBox: OutlineBox.optional(),
  examples: z
    .array(z.string())
    .max(6)
    .describe(
      "The wording this design shows, one entry per wording line in order; a line left out or empty shows the product's example.",
    )
    .optional(),
});
export type ProductStyle = z.infer<typeof ProductStyle>;

// Where the product definition comes from. `catalog` = a maker's code catalog,
// exported as a product package; `vector` = a traced or drawn SVG
// (the maker on-ramp, see PRODUCT-MODEL.md); `photo` = only a photo exists
// (weakest guarantees); `form` = typed in by the maker.
export const ProductSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("catalog"),
    adapterId: z.string().min(1),
    ref: z.string().min(1),
  }),
  z.object({
    kind: z.literal("vector"),
    svgUrl: z.string().min(1),
    scalePxPerUnit: z.number().positive().optional(),
    outlineBox: OutlineBox.optional(),
  }),
  z.object({ kind: z.literal("photo"), assetUrl: z.string().min(1) }),
  z.object({ kind: z.literal("form") }),
]);
export type ProductSource = z.infer<typeof ProductSource>;

// What no product shows unless its maker says otherwise.
export const DEFAULT_FORBIDDEN = [
  "other text",
  "logos",
  "people",
  "extra objects on the product",
] as const;

export const Product = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  family: z.string().min(1),
  description: z.string().optional(),
  // The whole product's box, as its drawing frames it (parts and all).
  dimensions: Dimensions,
  // The pieces it is made of, when more than one; absent for a single piece.
  parts: z.array(ProductPart).min(2).max(4).optional(),
  // Up to two more views of it (the front one is the reference).
  views: z.array(ProductView).min(1).max(2).optional(),
  shape: z.string().min(1),
  material: z.string().min(1),
  treatment: Treatment,
  colours: z.array(ColourOption).min(1),
  defaultColour: z.string().min(1),
  typography: Typography,
  wording: z.array(WordingLine).default([]),
  icons: z.array(ProductIcon).default([]),
  variants: z.array(VariantAxis).default([]),
  // Other designs of a vector product, each chosen per project and per
  // frame like a colour; absent for one design.
  styles: z.array(ProductStyle).min(1).max(8).optional(),
  styleName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe(
      'The name of the product\'s own drawing among its styles ("Quiet please"); "Original" when absent.',
    )
    .optional(),
  forbidden: z.array(z.string()).default([...DEFAULT_FORBIDDEN]),
  // Where the product is used, the most typical first ("a kitchen counter",
  // "an exterior front door"): scenes that show it in context take these in
  // order, so the in-use and lifestyle shots land where buyers will use it.
  useContexts: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
  // Marketing copy for text layers: the hook on a carousel's first slide and
  // the call to action. Templates fall back when absent (see exact.ts).
  hook: z.string().trim().min(1).max(80).optional(),
  cta: z.string().trim().min(1).max(40).optional(),
  // The maker's price (costing and margins are the maker's policy; Kiln never
  // computes a price). A variant value's priceExtra is added to it.
  price: z
    .number()
    .positive()
    .describe(
      "The maker's base price, in the shop's currency; each variant value's priceExtra is added to it.",
    )
    .optional(),
  source: ProductSource,
});
export type Product = z.infer<typeof Product>;

// One physical piece on the plate: a bar, a disc, a tile.
export const PlatePiece = z.object({
  colour: z.string().min(1),
  wording: z.array(z.string()).default([]),
  icon: z.string().optional(),
  iconPlacement: IconPlacement.optional(),
});
export type PlatePiece = z.infer<typeof PlatePiece>;

export const PlateRequest = z.object({
  productId: z.string().min(1),
  pieces: z.array(PlatePiece).min(1),
  layout: z.enum(["single", "row", "stack"]).default("single"),
  sizePx: z.number().int().min(512).max(4096).default(1024),
  ground: Hex.default("#F0EEE9"),
  // A baked shadow fights the lighting the image model invents; off by default.
  shadow: z.boolean().default(false),
});
export type PlateRequest = z.infer<typeof PlateRequest>;

export const PixelBox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

// What the QC gate (Phase 10) needs to verify a generated scene against the
// plate: the exact strings, how many pieces and icons, and where they sit.
export const PlateResult = z.object({
  productId: z.string().min(1),
  assetUrl: z.string().min(1),
  svgUrl: z.string().optional(),
  mime: z.string().default("image/png"),
  sizePx: z.number().int().positive(),
  ppi: z.number().positive(),
  pieces: z.array(
    z.object({
      bbox: PixelBox,
      expectedText: z.array(z.string()),
      colour: z.string(),
      icon: z.string().optional(),
    }),
  ),
  renderer: z.object({ id: z.string(), version: z.string() }),
  request: PlateRequest,
});
export type PlateResult = z.infer<typeof PlateResult>;

// A measurement as a maker writes it: two decimals at most, no trailing zero.
const fmt = (n: number) => String(Number(n.toFixed(2)));

export function dimensionsLabel(d: Dimensions): string {
  return `${fmt(d.w)} x ${fmt(d.h)} ${d.unit}`;
}

// A relief as a maker says it: inches as a fraction when one fits (0.125 ->
// "1/8 in"), else the number with its unit ("3 mm", "0.30 in").
export function reliefLabel(relief: number, unit: Unit): string {
  if (unit === "in") {
    for (const den of [2, 4, 8, 16, 32, 64]) {
      const num = relief * den;
      if (Math.abs(num - Math.round(num)) < 1e-6) {
        const n = Math.round(num);
        const whole = Math.floor(n / den);
        const rest = n % den;
        const frac = rest === 0 ? "" : `${rest}/${den}`;
        return `${[whole || "", frac].filter(Boolean).join(" ")} in`;
      }
    }
  }
  return `${fmt(relief)} ${unit}`;
}

// A part's size in words, by how it stands: an upright part is its face and
// how thick it is ("8 x 2.5 in, 0.14 in thick"); a part lying flat is its
// footprint and how thick it is ("9 x 2.25 in footprint, 1/4 in thick").
export function partLabel(part: ProductPart, unit: Unit): string {
  const { w, h, d } = part.dimensions;
  return part.lies === "flat"
    ? `${fmt(w)} x ${fmt(d)} ${unit} footprint, ${reliefLabel(h, unit)} thick`
    : `${fmt(w)} x ${fmt(h)} ${unit}, ${reliefLabel(d, unit)} thick`;
}

// The size the buyer buys: the main part's face when the product has parts,
// else the whole product's.
export function buyerSizeLabel(product: Product): string {
  const main = product.parts?.[0];
  if (!main) return dimensionsLabel(product.dimensions);
  const { w, h, d } = main.dimensions;
  const unit = product.dimensions.unit;
  return main.lies === "flat"
    ? `${fmt(w)} x ${fmt(d)} ${unit}`
    : `${fmt(w)} x ${fmt(h)} ${unit}`;
}

export function colourOf(product: Product, key: string): ColourOption {
  const c = product.colours.find((x) => x.key === key);
  if (!c) throw new Error(`unknown colour "${key}" for ${product.sku}`);
  return c;
}

// The material sample scenes are made with: the default colour's, since
// scenes show the product in its default colour. null without one.
export function defaultSwatch(product: Product): string | null {
  return colourOf(product, product.defaultColour).swatchUrl ?? null;
}

// A colour's look is checked against something real: a photo of its material,
// or its supplier's page. Without either, a scene draws it from its hex alone.
export function lookVerified(colour: ColourOption): boolean {
  return Boolean(colour.swatchUrl || safeLink(colour.supplierUrl));
}

// A link that is safe to draw: http or https only, so an imported
// `javascript:` never becomes a link. null otherwise.
export function safeLink(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export interface ProductImage {
  url: string;
  // What it shows: the material sample, or a view from one side.
  role: "sample" | ViewLabel;
  // Its place among the images an edit reads, the reference being the first
  // ("second", "third"): prompts name each image by it.
  place: string;
}

const PLACES = ["second", "third", "fourth"];

// The images a scene reads after the product's reference, in order: the
// default colour's material sample, then each view. One list, so the
// references a card sends and the words that name them never disagree.
export function productImages(product: Product): ProductImage[] {
  const sample = defaultSwatch(product);
  const urls: { url: string; role: ProductImage["role"] }[] = [
    ...(sample ? [{ url: sample, role: "sample" as const }] : []),
    ...(product.views ?? []).map((v) => ({ url: v.url, role: v.label })),
  ];
  return urls.map((image, i) => ({ ...image, place: PLACES[i] }));
}

// Checks a request against the product's wording rules before anything is
// rendered or billed. Returns human-readable problems; empty = ok.
export function validateWording(
  product: Product,
  pieces: PlatePiece[],
): string[] {
  const problems: string[] = [];
  pieces.forEach((piece, p) => {
    if (!product.colours.some((c) => c.key === piece.colour)) {
      problems.push(`piece ${p + 1}: colour "${piece.colour}" is not offered`);
    }
    product.wording.forEach((line, i) => {
      const text = piece.wording[i] ?? "";
      if (line.required && text.trim() === "") {
        problems.push(`piece ${p + 1}: "${line.label}" is required`);
      }
      if (line.maxChars !== null && text.length > line.maxChars) {
        problems.push(
          `piece ${p + 1}: "${line.label}" has ${text.length} characters, max ${line.maxChars}`,
        );
      }
    });
    if (piece.wording.length > product.wording.length) {
      problems.push(
        `piece ${p + 1}: ${piece.wording.length} lines given, product has ${product.wording.length}`,
      );
    }
    if (piece.icon && !product.icons.some((i) => i.key === piece.icon)) {
      problems.push(`piece ${p + 1}: icon "${piece.icon}" is not offered`);
    }
  });
  return problems;
}
