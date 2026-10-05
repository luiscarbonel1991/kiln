import { z } from "zod";

// Product-first model (ROADMAP Phase 8). The truth of a customizable physical
// product is its spec, not a photo: dimensions, material, colour set, typography,
// treatment and the wording the buyer types. A PlateRenderer turns (product,
// request) into an exact reference image; the prompt fields are templated from
// the same data so nobody hand-writes SUBJECT / MATERIALS again.

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex colour like #4B5F50");

export const Unit = z.enum(["in", "mm"]);
export type Unit = z.infer<typeof Unit>;

export const Dimensions = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
  d: z.number().positive().optional(),
  unit: Unit.default("in"),
});
export type Dimensions = z.infer<typeof Dimensions>;

// One sellable finish. `face` is what the camera sees; `inlay` is the contrast
// colour of the lettering on that face (white on dark, black on light).
export const ColourOption = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  face: Hex,
  edge: Hex.optional(),
  inlay: Hex.optional(),
  supplierUrl: z.string().optional(),
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

export const Treatment = z.enum([
  "raised",
  "inlaid",
  "engraved",
  "printed",
  "cut",
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
  }),
  z.object({ kind: z.literal("photo"), assetUrl: z.string().min(1) }),
  z.object({ kind: z.literal("form") }),
]);
export type ProductSource = z.infer<typeof ProductSource>;

export const Product = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  family: z.string().min(1),
  description: z.string().optional(),
  dimensions: Dimensions,
  shape: z.string().min(1),
  material: z.string().min(1),
  treatment: Treatment,
  colours: z.array(ColourOption).min(1),
  defaultColour: z.string().min(1),
  typography: Typography,
  wording: z.array(WordingLine).default([]),
  icons: z.array(ProductIcon).default([]),
  variants: z.array(VariantAxis).default([]),
  forbidden: z
    .array(z.string())
    .default(["other text", "logos", "people", "extra objects on the product"]),
  source: ProductSource,
});
export type Product = z.infer<typeof Product>;

// One physical piece on the plate: a bar, a disc, a plaque.
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

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function dimensionsLabel(d: Dimensions): string {
  return `${fmt(d.w)} x ${fmt(d.h)} ${d.unit}`;
}

export function colourOf(product: Product, key: string): ColourOption {
  const c = product.colours.find((x) => x.key === key);
  if (!c) throw new Error(`unknown colour "${key}" for ${product.sku}`);
  return c;
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
