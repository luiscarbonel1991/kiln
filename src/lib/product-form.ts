import { z } from "zod";
import { colourTextConflict, colourTextWarning } from "@/domain/colour-text";
import { colourWord } from "@/domain/colour-words";
import {
  type ColourOption,
  DEFAULT_FORBIDDEN,
  Hex,
  Product,
  type ProductStyle,
  safeLink,
  Treatment,
  Unit,
  ViewLabel,
} from "@/domain/product";
import { ORIGINAL } from "@/domain/product-look";

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
  {
    value: "reveal",
    label: "Layered",
    hint: "A top layer cut through, showing a base of another colour",
  },
  {
    value: "letters",
    label: "Loose letters",
    hint: "Each letter or digit is its own piece, no backing",
  },
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

// How long each text may be. An imported product may hold longer text than
// a new one is allowed: editLimits keeps it editable at its own length.
export interface FormLimits {
  name: number;
  whatItIs: number;
  family: number;
  material: number;
  colourName: number;
  label: number;
  example: number;
  description: number;
}

export const FORM_LIMITS: FormLimits = {
  name: 80,
  whatItIs: 60,
  family: 40,
  material: 60,
  colourName: 40,
  label: 40,
  example: 60,
  description: 1000,
};

export function productFormSchema(limits: FormLimits = FORM_LIMITS) {
  return z
    .object({
      name: z.string().trim().min(1, "Name the product.").max(limits.name),
      whatItIs: z
        .string()
        .trim()
        .min(1, "Say what it is, like “round coaster”.")
        .max(limits.whatItIs),
      // The product's family ("Wall decor", "Kitchen"): Kiln remembers choices
      // per family, like the hero's setting. Empty reads as "General".
      family: z.string().trim().max(limits.family).default(""),
      width: z.number().positive("Give its width."),
      height: z.number().positive("Give its height."),
      unit: Unit,
      material: z
        .string()
        .trim()
        .min(1, "Name its material.")
        .max(limits.material),
      treatment: Treatment,
      colours: z
        .array(
          z.object({
            // The stored colour this row edits (absent for a new one).
            key: z.string().min(1).optional(),
            name: z
              .string()
              .trim()
              .min(1, "Name this colour.")
              .max(limits.colourName),
            hex: Hex,
            // A photo of the material in this colour, uploaded to Kiln's
            // storage.
            swatchUrl: z.string().min(1).optional(),
            // A layered finish: the base layer's colour, which shows through
            // the cuts (the colour's inlay).
            base: Hex.optional(),
            // The product's name and material in this colour, for a product
            // whose own text names another colour; empty reads the product's.
            productName: z.string().trim().max(limits.name).optional(),
            material: z.string().trim().max(limits.material).optional(),
            // The supplier's page for this colour, opened by the maker to
            // compare; Kiln never fetches it.
            supplierUrl: z
              .string()
              .trim()
              .max(2000)
              .refine((url) => safeLink(url) !== null, {
                message: "Paste the supplier's page, starting with https://.",
              })
              .optional(),
          }),
        )
        .min(1, "Add at least one colour.")
        .max(8),
      wording: z
        .array(
          z
            .object({
              label: z
                .string()
                .trim()
                .min(1, "Say what the buyer writes, like “Name”.")
                .max(limits.label),
              example: z.string().trim().max(limits.example).optional(),
              // The most characters the buyer may type; null when the text
              // is fitted to the piece.
              maxChars: z
                .number()
                .int()
                .min(1)
                .max(200)
                .nullable()
                .default(null),
              required: z.boolean().default(true),
            })
            .refine(
              (w) =>
                w.maxChars === null ||
                w.example === undefined ||
                w.example.length <= w.maxChars,
              {
                path: ["example"],
                message:
                  "The example is longer than the most characters allowed.",
              },
            ),
        )
        .max(3)
        .default([]),
      // Where it's used, the most typical first.
      useContexts: z
        .array(
          z.string().trim().min(1, "Describe the place, or remove it.").max(80),
        )
        .max(6)
        .default([]),
      // Which colour is the default (its row).
      defaultColour: z.number().int().min(0).default(0),
      depth: z.number().positive("A thickness is more than 0.").optional(),
      relief: z.number().positive("A relief is more than 0.").optional(),
      hook: z.string().trim().max(80).optional(),
      cta: z.string().trim().max(40).optional(),
      description: z.string().trim().max(limits.description).optional(),
      // The maker's price, in the shop's currency (optional; a listing
      // needs it).
      price: z.number().positive("A price is more than 0.").optional(),
      // Up to two more views of the piece, uploaded to Kiln's storage.
      views: z
        .array(z.object({ label: ViewLabel, url: z.string().min(1) }))
        .max(2)
        .default([]),
      // Other designs of a vector product: each its own drawing of the same
      // piece, uploaded to Kiln's storage, with the wording it shows (a line
      // left empty shows the product's example). `styleName` names the
      // product's own drawing among them.
      styleName: z.string().trim().max(40).optional(),
      styles: z
        .array(
          z.object({
            // The stored style this row edits (absent for a new one).
            key: z.string().min(1).optional(),
            name: z.string().trim().min(1, "Name this style.").max(40),
            url: z.string().min(1),
            examples: z
              .array(z.string().trim().max(limits.example))
              .max(3)
              .default([]),
          }),
        )
        .max(8)
        .default([]),
      file: ProductFile.optional(),
    })
    .refine(
      (f) => f.colours.length === 0 || f.defaultColour < f.colours.length,
      {
        path: ["defaultColour"],
        message: "The default colour must be one of its colours.",
      },
    )
    .superRefine((f, ctx) => {
      if (f.styles.length > 0 && f.file?.kind !== "vector") {
        ctx.addIssue({
          code: "custom",
          path: ["styles"],
          message:
            "Styles are other drawings of the design: give the product its SVG first.",
        });
      }
      f.styles.forEach((style, i) => {
        style.examples.forEach((example, j) => {
          const max = f.wording[j]?.maxChars;
          if (max != null && example.length > max) {
            ctx.addIssue({
              code: "custom",
              path: ["styles", i, "examples", j],
              message: `At most ${max} characters, as the line allows.`,
            });
          }
        });
      });
      if (f.treatment !== "reveal") return;
      f.colours.forEach((c, i) => {
        if (!c.base) {
          ctx.addIssue({
            code: "custom",
            path: ["colours", i, "base"],
            message: "Pick the colour that shows through the cuts.",
          });
        }
      });
    });
}

export const ProductForm = productFormSchema();
// What a form sends (defaults filled on parse).
export type ProductForm = z.input<typeof ProductForm>;

// A form problem at its field ("wording.0.label"), in words.
export interface FormIssue {
  path: string;
  message: string;
}

// The form's problems, the first per field.
export function formIssues(
  input: unknown,
  limits: FormLimits = FORM_LIMITS,
): FormIssue[] {
  const parsed = productFormSchema(limits).safeParse(input);
  if (parsed.success) return [];
  const seen = new Set<string>();
  return parsed.error.issues.flatMap((issue) => {
    const path = issue.path.join(".");
    if (seen.has(path)) return [];
    seen.add(path);
    return [{ path, message: issue.message }];
  });
}

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

// A grey is named by how light it is (a near-black never reads as brown).
const GREYS: [number, string][] = [
  [48, "Black"],
  [96, "Charcoal"],
  [160, "Grey"],
  [215, "Silver"],
  [256, "White"],
];

// "#d9b98c" -> "Tan": a starting name the maker can change.
export function colourName(hex: string): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (Math.max(...rgb) - Math.min(...rgb) < 18) {
    const light = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return GREYS.find(([below]) => light < below)?.[1] ?? "White";
  }
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
    family: form.family || "General",
    dimensions: {
      w: form.width,
      h: form.height,
      unit: form.unit,
      ...(form.depth ? { d: form.depth } : {}),
      ...(form.relief ? { relief: form.relief } : {}),
    },
    shape: form.whatItIs,
    material: form.material,
    treatment: form.treatment,
    colours: form.colours.map((c, i) => ({
      key: keys[i],
      name: c.name,
      face: c.hex.toUpperCase(),
      ...(c.base ? { inlay: c.base.toUpperCase() } : {}),
      ...(c.swatchUrl ? { swatchUrl: c.swatchUrl } : {}),
      ...(c.supplierUrl ? { supplierUrl: c.supplierUrl } : {}),
      ...(c.productName ? { productName: c.productName } : {}),
      ...(c.material ? { material: c.material } : {}),
    })),
    defaultColour: keys[form.defaultColour] ?? keys[0],
    typography: { family: "Hanken Grotesk" },
    wording: form.wording.map((w) => ({
      label: w.label,
      maxChars: w.maxChars,
      required: w.required,
      ...(w.example ? { example: w.example } : {}),
    })),
    useContexts: form.useContexts,
    ...(form.hook ? { hook: form.hook } : {}),
    ...(form.cta ? { cta: form.cta } : {}),
    ...(form.description ? { description: form.description } : {}),
    ...(form.price ? { price: form.price } : {}),
    ...(form.views.length > 0 ? { views: form.views } : {}),
    ...styleFields(form, new Map()),
    source,
  });
}

// The form's styles as the product holds them: a stored style keeps its key,
// a new one takes one from its name (never "original", the own drawing's);
// trailing empty examples are dropped, and a style with none shows the
// product's wording. Only a vector product has styles.
function styleFields(
  form: z.output<typeof ProductForm>,
  stored: Map<string, ProductStyle>,
): Pick<Product, "styles" | "styleName"> {
  if (form.file?.kind !== "vector") return {};
  const taken = new Set([
    ORIGINAL,
    ...form.styles.flatMap((s) => (s.key && stored.has(s.key) ? [s.key] : [])),
  ]);
  const styles = form.styles.map((s) => {
    const kept = s.key ? stored.get(s.key) : undefined;
    const examples = [...s.examples];
    while (examples.length > 0 && examples.at(-1) === "") examples.pop();
    return {
      key: kept?.key ?? freshKey(s.name, taken),
      name: s.name,
      svgUrl: s.url,
      ...(kept?.outlineBox && kept.svgUrl === s.url
        ? { outlineBox: kept.outlineBox }
        : {}),
      ...(examples.length > 0 ? { examples } : {}),
    };
  });
  return {
    ...(styles.length > 0 ? { styles } : {}),
    ...(form.styleName ? { styleName: form.styleName } : {}),
  };
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

// An imported product may hold longer text than a new one is allowed: it
// stays editable at its own length, never longer.
export function editLimits(product: Product): FormLimits {
  const longest = (values: (string | undefined)[]) =>
    Math.max(0, ...values.map((v) => v?.length ?? 0));
  return {
    name: Math.max(
      FORM_LIMITS.name,
      longest([product.name, ...product.colours.map((c) => c.productName)]),
    ),
    whatItIs: Math.max(FORM_LIMITS.whatItIs, product.shape.length),
    family: Math.max(FORM_LIMITS.family, product.family.length),
    material: Math.max(
      FORM_LIMITS.material,
      longest([product.material, ...product.colours.map((c) => c.material)]),
    ),
    colourName: Math.max(
      FORM_LIMITS.colourName,
      longest(product.colours.map((c) => c.name)),
    ),
    label: Math.max(
      FORM_LIMITS.label,
      longest(product.wording.map((w) => w.label)),
    ),
    example: Math.max(
      FORM_LIMITS.example,
      longest(product.wording.map((w) => w.example)),
    ),
    description: Math.max(
      FORM_LIMITS.description,
      product.description?.length ?? 0,
    ),
  };
}

// The product as the form shows it, to edit; what the form does not show
// stays in the product (mergeForm).
export function formFromProduct(product: Product): ProductForm {
  const source = product.source;
  const d = product.dimensions;
  const file: ProductFile | undefined =
    source.kind === "photo"
      ? { kind: "photo", url: source.assetUrl }
      : source.kind === "vector"
        ? {
            kind: "vector",
            url: source.svgUrl,
            ...(source.scalePxPerUnit
              ? { drawnWidthPx: source.scalePxPerUnit * d.w }
              : {}),
          }
        : undefined;
  return {
    name: product.name,
    whatItIs: product.shape,
    family: product.family,
    width: d.w,
    height: d.h,
    unit: d.unit,
    material: product.material,
    treatment: product.treatment,
    colours: product.colours.map((c) => ({
      key: c.key,
      name: c.name,
      hex: c.face,
      ...(c.inlay ? { base: c.inlay } : {}),
      ...(c.swatchUrl ? { swatchUrl: c.swatchUrl } : {}),
      ...(safeLink(c.supplierUrl) ? { supplierUrl: c.supplierUrl } : {}),
      ...(c.productName ? { productName: c.productName } : {}),
      ...(c.material ? { material: c.material } : {}),
    })),
    defaultColour: Math.max(
      0,
      product.colours.findIndex((c) => c.key === product.defaultColour),
    ),
    wording: product.wording.map((w) => ({
      label: w.label,
      ...(w.example !== undefined ? { example: w.example } : {}),
      maxChars: w.maxChars,
      required: w.required,
    })),
    useContexts: product.useContexts,
    ...(d.d ? { depth: d.d } : {}),
    ...(d.relief ? { relief: d.relief } : {}),
    ...(product.hook ? { hook: product.hook } : {}),
    ...(product.cta ? { cta: product.cta } : {}),
    ...(product.description ? { description: product.description } : {}),
    ...(product.price ? { price: product.price } : {}),
    views: product.views ?? [],
    ...(product.styleName ? { styleName: product.styleName } : {}),
    styles: (product.styles ?? []).map((s) => ({
      key: s.key,
      name: s.name,
      url: s.svgUrl,
      examples: s.examples ?? [],
    })),
    ...(file ? { file } : {}),
  };
}

// A key no other colour has, from the colour's name.
function freshKey(name: string, taken: Set<string>): string {
  const base = slug(name) || "colour";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

// The form laid over the stored product: what the form shows is replaced
// (an optional field left empty is removed), everything else is kept as it
// was — the sku (even when renamed), typography, parts, icons,
// variants, things to avoid, and each kept colour's edge, inlay, stock and
// own things to avoid (a layered finish's base is the inlay the form edits).
// Opening and saving without a change gives the same product.
export function mergeForm(
  stored: Product,
  input: ProductForm,
): { product: Product } | { error: string; issues: FormIssue[] } {
  const limits = editLimits(stored);
  const parsed = productFormSchema(limits).safeParse(input);
  if (!parsed.success) {
    const issues = formIssues(input, limits);
    return { error: issues[0]?.message ?? "Check the form.", issues };
  }
  const form = parsed.data;
  if (stored.parts && form.unit !== stored.dimensions.unit) {
    const message = `Its parts are measured in ${stored.dimensions.unit}: change the unit in its package.`;
    return { error: message, issues: [{ path: "unit", message }] };
  }
  const before = new Map(stored.colours.map((c) => [c.key, c]));
  const taken = new Set(
    form.colours.flatMap((c) => (c.key && before.has(c.key) ? [c.key] : [])),
  );
  const colours = form.colours.map((c) => {
    const kept = c.key ? before.get(c.key) : undefined;
    const {
      swatchUrl: _swatch,
      supplierUrl: stored,
      productName: _productName,
      material: _material,
      inlayName,
      ...rest
    }: Partial<ColourOption> = kept ?? {};
    // The form shows a supplier link only when it is one; anything else an
    // import stored there is kept as it was.
    const supplierUrl =
      c.supplierUrl ?? (safeLink(stored) ? undefined : stored);
    // A new base colour: the old one's name no longer fits it.
    const base =
      c.base && kept?.inlay?.toUpperCase() !== c.base.toUpperCase()
        ? c.base.toUpperCase()
        : undefined;
    return {
      ...rest,
      ...(inlayName && !base ? { inlayName } : {}),
      key: kept?.key ?? freshKey(c.name, taken),
      name: c.name,
      face:
        kept && kept.face.toUpperCase() === c.hex.toUpperCase()
          ? kept.face
          : c.hex.toUpperCase(),
      ...(base ? { inlay: base } : {}),
      ...(c.swatchUrl ? { swatchUrl: c.swatchUrl } : {}),
      ...(supplierUrl ? { supplierUrl } : {}),
      ...(c.productName ? { productName: c.productName } : {}),
      ...(c.material ? { material: c.material } : {}),
    };
  });
  const old = stored.source;
  const sameDrawing =
    old.kind === "vector" &&
    form.file?.kind === "vector" &&
    form.file.url === old.svgUrl &&
    form.width === stored.dimensions.w;
  const source =
    old.kind === "catalog" || sameDrawing
      ? old
      : form.file?.kind === "photo"
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
  const {
    price: _price,
    hook: _hook,
    cta: _cta,
    description: _description,
    views: _views,
    styles: storedStyles,
    styleName: _styleName,
    ...base
  } = stored;
  return {
    product: Product.parse({
      ...base,
      name: form.name,
      family: form.family || stored.family,
      shape: form.whatItIs,
      material: form.material,
      treatment: form.treatment,
      dimensions: {
        w: form.width,
        h: form.height,
        unit: form.unit,
        ...(form.depth ? { d: form.depth } : {}),
        ...(form.relief ? { relief: form.relief } : {}),
      },
      colours,
      defaultColour: colours[form.defaultColour]?.key ?? colours[0].key,
      wording: form.wording.map((w) => ({
        label: w.label,
        maxChars: w.maxChars,
        required: w.required,
        ...(w.example !== undefined ? { example: w.example } : {}),
      })),
      useContexts: form.useContexts,
      ...(form.price ? { price: form.price } : {}),
      ...(form.hook ? { hook: form.hook } : {}),
      ...(form.cta ? { cta: form.cta } : {}),
      ...(form.description ? { description: form.description } : {}),
      ...(form.views.length > 0 ? { views: form.views } : {}),
      ...styleFields(
        form,
        new Map((storedStyles ?? []).map((s) => [s.key, s])),
      ),
      source,
    }),
  };
}

// What the product holds that the form does not show, in words: it is
// kept as it is ("2 parts (plate, base)", "variants (Size)").
export function keptWords(product: Product): string[] {
  const parts = product.parts ?? [];
  // A layered finish's base is the inlay the form shows.
  const layered = product.treatment === "reveal";
  const extras = product.colours.some(
    (c) => c.edge || (!layered && (c.inlay || c.inlayName)),
  );
  return [
    ...(parts.length > 0
      ? [`${parts.length} parts (${parts.map((p) => p.name).join(", ")})`]
      : []),
    ...(product.variants.length > 0
      ? [`variants (${product.variants.map((v) => v.name).join(", ")})`]
      : []),
    ...(product.icons.length > 0 ? [`${product.icons.length} icons`] : []),
    ...(product.forbidden.join("|") !== DEFAULT_FORBIDDEN.join("|")
      ? [`${product.forbidden.length} things to avoid`]
      : []),
    ...(extras
      ? [layered ? "each colour's edge" : "each colour's edge and inlay"]
      : []),
    ...product.colours.flatMap((c) =>
      c.forbidden ? [`${c.name}'s own things to avoid`] : [],
    ),
    `typeface ${product.typography.family}`,
  ];
}

// What the form does not edit but a colour's text is checked against: the
// product's things to avoid, and each colour's own (by key).
export interface FormAvoid {
  product: string[];
  colours: Record<string, string[]>;
}

export const NEW_AVOID: FormAvoid = {
  product: [...DEFAULT_FORBIDDEN],
  colours: {},
};

export function avoidOf(product: Product): FormAvoid {
  return {
    product: product.forbidden,
    colours: Object.fromEntries(
      product.colours.flatMap((c) =>
        c.forbidden ? [[c.key, c.forbidden]] : [],
      ),
    ),
  };
}

// Each colour row's warning, as the form stands: the product's name or
// material saying the default's colours, or its things to avoid naming this
// one (colourTextWarning); null for a row with nothing to fix.
export function colourTextWarnings(
  form: Pick<ProductForm, "name" | "material" | "colours" | "defaultColour">,
  avoid: FormAvoid,
): (string | null)[] {
  const keys = form.colours.map((c, i) => c.key ?? `row-${i}`);
  const text = {
    name: form.name,
    material: form.material,
    forbidden: avoid.product,
    defaultColour: keys[form.defaultColour ?? 0] ?? keys[0],
    colours: form.colours.map((c, i) => ({
      key: keys[i],
      name: c.name,
      face: c.hex,
      inStock: true,
      ...(c.productName?.trim() ? { productName: c.productName } : {}),
      ...(c.material?.trim() ? { material: c.material } : {}),
      ...(c.key && avoid.colours[c.key]
        ? { forbidden: avoid.colours[c.key] }
        : {}),
    })),
  };
  // The form edits a colour's name and material; its things to avoid come
  // from its package, so the warning says where to give it its own.
  return keys.map((key, i) => {
    const warning = colourTextWarning(text, key);
    return warning && colourTextConflict(text, key)?.forbids.length
      ? `${warning} Its things to avoid come from its package: give ${form.colours[i].name} its own forbidden list there.`
      : warning;
  });
}
