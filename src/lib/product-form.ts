import { z } from "zod";
import { colourWord } from "@/domain/colour-words";
import { Hex, Product, Treatment, Unit } from "@/domain/product";

// The product form (New project, step 1): the few things a maker knows about
// a piece, in plain words, turned into a Product. Kiln fills the rest — the
// sku from the name, the colour keys, the default colour (the first), a family
// and a typography — so nobody writes a package by hand. The source follows
// the file: a photo becomes the scenes' reference, an SVG the plate drawn to
// scale, no file a product whose reference is added on the board.

export const FINISHES: { value: Treatment; label: string; hint: string }[] = [
  {
    value: "engraved",
    label: "Engraved",
    hint: "Marks cut into the surface",
  },
  {
    value: "raised",
    label: "Raised",
    hint: "Letters or shapes standing out from the face",
  },
  {
    value: "inlaid",
    label: "Inlaid",
    hint: "Marks filled with a second material or colour",
  },
  {
    value: "printed",
    label: "Printed",
    hint: "Printed or painted on, flat",
  },
  { value: "cut", label: "Cut out", hint: "The shape itself is cut through" },
];

export const ProductFile = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("photo"), url: z.string().min(1) }),
  z.object({
    kind: z.literal("vector"),
    url: z.string().min(1),
    // The drawing's width in SVG pixels (measured at upload): with the width
    // the maker gives, the scale the frames are drawn at.
    drawnWidthPx: z.number().positive().optional(),
  }),
]);
export type ProductFile = z.infer<typeof ProductFile>;

export const ProductForm = z.object({
  name: z.string().trim().min(1, "Name the product.").max(80),
  whatItIs: z
    .string()
    .trim()
    .min(1, "Say what it is, like “round coaster”.")
    .max(60),
  width: z.number().positive("Give its width."),
  height: z.number().positive("Give its height."),
  unit: Unit,
  material: z.string().trim().min(1, "Name its material.").max(60),
  treatment: Treatment,
  colours: z
    .array(z.object({ name: z.string().trim().min(1).max(40), hex: Hex }))
    .min(1, "Add at least one colour.")
    .max(8),
  wording: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        example: z.string().trim().max(60).optional(),
      }),
    )
    .max(3)
    .default([]),
  useContext: z.string().trim().max(80).optional(),
  file: ProductFile.optional(),
});
export type ProductForm = z.infer<typeof ProductForm>;

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// "Round coaster" + "7k2" -> "round-coaster-7k2": readable, and unique enough
// that two products with the same name never overwrite each other (the import
// upserts on sku).
export function skuFor(name: string, suffix: string): string {
  return `${slug(name).slice(0, 40) || "product"}-${suffix}`;
}

// Unique colour keys from their names ("Natural", "Natural" -> natural,
// natural-2).
function colourKeys(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = slug(name) || "colour";
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    taken.add(key);
    return key;
  });
}

// "#d9b98c" -> "Tan": a starting name the maker can change.
export function colourName(hex: string): string {
  const word = colourWord(hex);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function productFromForm(input: ProductForm, suffix: string): Product {
  const form = ProductForm.parse(input);
  const keys = colourKeys(form.colours.map((c) => c.name));
  const source =
    form.file?.kind === "photo"
      ? { kind: "photo" as const, assetUrl: form.file.url }
      : form.file?.kind === "vector"
        ? {
            kind: "vector" as const,
            svgUrl: form.file.url,
            ...(form.file.drawnWidthPx
              ? { scalePxPerUnit: form.file.drawnWidthPx / form.width }
              : {}),
          }
        : { kind: "form" as const };
  const sku = skuFor(form.name, suffix);
  return Product.parse({
    id: sku,
    sku,
    name: form.name,
    family: "General",
    dimensions: { w: form.width, h: form.height, unit: form.unit },
    shape: form.whatItIs,
    material: form.material,
    treatment: form.treatment,
    colours: form.colours.map((c, i) => ({
      key: keys[i],
      name: c.name,
      face: c.hex.toUpperCase(),
    })),
    defaultColour: keys[0],
    typography: { family: "Hanken Grotesk" },
    wording: form.wording.map((w) => ({
      label: w.label,
      maxChars: null,
      ...(w.example ? { example: w.example } : {}),
    })),
    useContexts: form.useContext ? [form.useContext] : [],
    source,
  });
}

const FILL =
  /(?:fill|stroke|stop-color)\s*(?:=\s*["']|:\s*)(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/g;

const longHex = (hex: string) =>
  hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;

// The colours an SVG paints with, most used first (fills, strokes, gradient
// stops; up to `max`): a design's own colours prefill the form for free.
export function svgColours(svg: string, max = 6): string[] {
  const counts = new Map<string, number>();
  for (const match of svg.matchAll(FILL)) {
    const hex = longHex(match[1]).toUpperCase();
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([hex]) => hex);
}

// A product package's default colour must be one of its colours: a typo would
// import and only fail later, when a frame or a scene needs it.
export function unknownDefaultColours(products: Product[]): string[] {
  return products.flatMap((p) =>
    p.colours.some((c) => c.key === p.defaultColour)
      ? []
      : [
          `sku "${p.sku}": defaultColour "${p.defaultColour}" is not one of its colours (${p.colours.map((c) => c.key).join(", ")})`,
        ],
  );
}
