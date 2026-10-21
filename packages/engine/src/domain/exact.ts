import type { BrandKit } from "@/domain/brand";
import {
  buyerSizeLabel,
  type ColourOption,
  colourOf,
  type Dimensions,
  type Product,
  partLabel,
  type Treatment,
} from "@/domain/product";
import type { ExactKind } from "@/domain/shot-list";

// View models for exact slots: everything a frame shows, computed from the
// product spec alone — no image model, no cost, the same output every time. The
// app draws them (SVG); a delivery step can rasterize the same models later.

export const TREATMENT_LABEL: Record<Treatment, string> = {
  raised: "Raised",
  inlaid: "Inlaid",
  engraved: "Engraved",
  printed: "Printed",
  cut: "Cut-out",
};

// The call to action when the product names none: invite personalization only
// when there is something to personalize.
export function defaultCta(product: Product): string {
  return product.wording.length > 0
    ? "Personalize yours"
    : "Shop the collection";
}

// "{product.name}"-style tokens. Unknown tokens stay as written, so a typo is
// visible on the frame instead of silently vanishing. `product.hook` and
// `product.cta` fall back to the name and to defaultCta.
export function renderTextTemplate(template: string, product: Product): string {
  const values: Record<string, string> = {
    "product.name": product.name,
    "product.hook": product.hook ?? product.name,
    "product.cta": product.cta ?? defaultCta(product),
    "product.family": product.family,
    // What the buyer buys: the main part's size when the product has parts.
    "product.dimensions": buyerSizeLabel(product),
    "product.material": product.material,
    "product.shape": product.shape,
    "colours.count": String(product.colours.length),
    "colours.counted": `${product.colours.length} colour${product.colours.length === 1 ? "" : "s"}`,
  };
  return template.replace(/\{([a-z.]+)\}/g, (token, key: string) =>
    key in values ? values[key] : token,
  );
}

// The product as a flat shape for frames drawn to scale: its size, whether it
// is round, its default colour and what its face says. The app draws the
// product's plate image when it has one, else this outline.
export interface ProductOutline {
  width: number;
  height: number;
  unit: Dimensions["unit"];
  round: boolean;
  face: string;
  wording: string[];
}

export function productOutline(product: Product): ProductOutline {
  const d = product.dimensions;
  return {
    width: d.w,
    height: d.h,
    unit: d.unit,
    round: /\b(round|circle|circular|disc|disk|oval)\b/i.test(product.shape),
    face: colourOf(product, product.defaultColour).face,
    wording: product.wording
      .map((w) => w.example?.trim() ?? "")
      .filter((e) => e !== ""),
  };
}

// Everyday objects of a known size a buyer reads at a glance, for drawings to
// scale (sizes in inches; an ISO credit card, a typical phone, a US letter
// sheet, a standard interior door).
const SCALE_REFERENCES = [
  { key: "card", name: "a credit card", width: 3.37, height: 2.13 },
  { key: "phone", name: "a phone", width: 2.8, height: 5.8 },
  { key: "letter", name: "a letter sheet", width: 8.5, height: 11 },
  { key: "door", name: "a door", width: 36, height: 80 },
] as const;

export interface ScaleReference {
  key: (typeof SCALE_REFERENCES)[number]["key"];
  name: string;
  // In the product's unit.
  width: number;
  height: number;
}

// The reference whose size is closest to the product's (by the longest side,
// on a log scale), in the product's unit.
export function scaleReference(dimensions: Dimensions): ScaleReference {
  const perInch = dimensions.unit === "mm" ? 25.4 : 1;
  const longest = Math.max(dimensions.w, dimensions.h) / perInch;
  const distance = (r: (typeof SCALE_REFERENCES)[number]) =>
    Math.abs(Math.log(Math.max(r.width, r.height) / longest));
  const best = SCALE_REFERENCES.reduce((a, b) =>
    distance(b) < distance(a) ? b : a,
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    key: best.key,
    name: best.name,
    width: round2(best.width * perInch),
    height: round2(best.height * perInch),
  };
}

export type SizeRelation = "smaller than" | "about the size of" | "larger than";

// The product beside its everyday reference, in words: "smaller than a
// credit card" (by the longest sides; within 15 % reads "about the size of").
export function sizeComparison(dimensions: Dimensions): {
  reference: ScaleReference;
  relation: SizeRelation;
  words: string;
} {
  const reference = scaleReference(dimensions);
  const ratio =
    Math.max(dimensions.w, dimensions.h) /
    Math.max(reference.width, reference.height);
  const relation: SizeRelation =
    ratio < 0.85
      ? "smaller than"
      : ratio > 1.15
        ? "larger than"
        : "about the size of";
  return { reference, relation, words: `${relation} ${reference.name}` };
}

// Readable ink on a colour: near-black on light colours, white on dark ones
// (WCAG relative luminance).
export function contrastInk(hex: string): "#241f18" | "#ffffff" {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return l > 0.4 ? "#241f18" : "#ffffff";
}

// Neutral ink for text layers when the maker has no brand kit: Kiln's own
// accent never stands in for a maker's brand.
export const NEUTRAL_INK = "#241f18";

// The colours of a text layer (the CTA card, the hook band): the brand's lead
// colour, else neutral ink, with readable ink on it.
export function textLayerColours(brand: BrandKit | null | undefined): {
  background: string;
  ink: string;
} {
  const background = brand?.palette[0] ?? NEUTRAL_INK;
  return { background, ink: contrastInk(background) };
}

// "@northwind · northwind.shop", or null without a handle or a link.
export function shopLine(brand: BrandKit | null | undefined): string | null {
  let host: string | null = null;
  if (brand?.url) {
    try {
      host = new URL(brand.url).host.replace(/^www\./, "");
    } catch {
      host = null;
    }
  }
  const parts = [brand?.handle ? `@${brand.handle}` : null, host].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

const DEFAULT_TITLE: Record<ExactKind, string> = {
  "colour-grid": "Available in {colours.counted}",
  "size-spec": "{product.dimensions}",
  scale: "Shown to scale",
  personalize: "Make it yours",
  "text-card": "{product.name}",
};

export type ExactView =
  | { kind: "colour-grid"; title: string; swatches: ColourOption[] }
  | {
      kind: "size-spec";
      title: string;
      width: number;
      height: number;
      unit: string;
      depth?: number;
      // The drawing is the whole product (parts and all), so its measures
      // say "overall"; the parts' own sizes are rows in the facts.
      overall?: boolean;
      product: ProductOutline;
      // Buyer-facing facts only: no internal fields such as the typeface. A
      // droppable fact (the shape, the material) is left off the sheet when
      // it is too long to print, a visual brief the drawing already shows.
      facts: { label: string; value: string; droppable?: boolean }[];
    }
  | {
      kind: "personalize";
      title: string;
      lines: {
        label: string;
        maxChars: number | null;
        required: boolean;
        example?: string;
      }[];
    }
  | {
      kind: "scale";
      title: string;
      product: ProductOutline;
      reference: ScaleReference;
    }
  | {
      kind: "text-card";
      title: string;
      subtitle: string;
      background: string;
      ink: string;
    };

// `brand` (the maker's kit, when it has one) styles the text layers.
export function exactView(
  kind: ExactKind,
  product: Product,
  textTemplate?: string,
  brand?: BrandKit | null,
): ExactView {
  const title = renderTextTemplate(
    textTemplate ?? DEFAULT_TITLE[kind],
    product,
  );
  switch (kind) {
    case "colour-grid":
      return { kind, title, swatches: product.colours };
    case "size-spec": {
      const d = product.dimensions;
      const parts = product.parts ?? [];
      return {
        kind,
        title,
        width: d.w,
        height: d.h,
        unit: d.unit,
        ...(parts.length > 0 ? { overall: true } : d.d ? { depth: d.d } : {}),
        product: productOutline(product),
        facts: [
          { label: "Shape", value: product.shape, droppable: true },
          { label: "Material", value: product.material, droppable: true },
          ...parts.map((part) => ({
            label: part.name,
            value: `${partLabel(part, d.unit)}${part.colour ? `, ${part.colour.name}` : ""}`,
          })),
          { label: "Finish", value: TREATMENT_LABEL[product.treatment] },
        ],
      };
    }
    case "scale":
      return {
        kind,
        title,
        product: productOutline(product),
        reference: scaleReference(product.dimensions),
      };
    case "personalize":
      return {
        kind,
        title,
        lines: product.wording.map((w) => ({
          label: w.label,
          maxChars: w.maxChars,
          required: w.required,
          ...(w.example ? { example: w.example } : {}),
        })),
      };
    case "text-card":
      return {
        kind,
        title,
        subtitle: shopLine(brand) ?? product.family,
        ...textLayerColours(brand),
      };
  }
}
