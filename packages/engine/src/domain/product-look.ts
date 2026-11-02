import { z } from "zod";
import { colourOf, type Product, type ProductStyle } from "@/domain/product";

// A look: the product as one frame shows it, in one of its colours and one of
// its styles (ROADMAP P2-9, the wording × colour matrix). A frame's own look
// wins over its project's, and the project's over the product's default
// colour and own drawing. A key the product no longer offers is passed over,
// so a colour or style removed later reads as unset instead of breaking the
// plan.
export const Look = z.object({
  colour: z.string().min(1).max(64).optional(),
  // A style's key, or ORIGINAL for the product's own drawing.
  style: z.string().min(1).max(64).optional(),
});
export type Look = z.infer<typeof Look>;

// The style key of the product's own drawing; no style may take it.
export const ORIGINAL = "original";
const ORIGINAL_NAME = "Original";

export interface ResolvedLook {
  colour: string;
  // null: the product's own drawing.
  style: string | null;
}

// A vector product's other designs; other products draw nothing to choose.
export function productStyles(product: Product): ProductStyle[] {
  return product.source.kind === "vector" ? (product.styles ?? []) : [];
}

export function resolveLook(
  product: Product,
  ...looks: (Look | undefined)[]
): ResolvedLook {
  const colours = new Set(product.colours.map((c) => c.key));
  const styles = new Set([
    ORIGINAL,
    ...productStyles(product).map((s) => s.key),
  ]);
  const colour =
    looks
      .map((l) => l?.colour)
      .find((k) => k !== undefined && colours.has(k)) ?? product.defaultColour;
  const style =
    looks.map((l) => l?.style).find((k) => k !== undefined && styles.has(k)) ??
    ORIGINAL;
  return { colour, style: style === ORIGINAL ? null : style };
}

export function sameLook(a: ResolvedLook, b: ResolvedLook): boolean {
  return a.colour === b.colour && a.style === b.style;
}

// The look as the plan stores it: the style named, the own drawing too, so a
// frame can show the original under a project in another style.
export function storedLook(look: ResolvedLook): Look {
  return { colour: look.colour, style: look.style ?? ORIGINAL };
}

export function styleName(product: Product, style: string | null): string {
  const found = style
    ? productStyles(product).find((s) => s.key === style)
    : undefined;
  return found?.name ?? product.styleName ?? ORIGINAL_NAME;
}

// "Gold/Black", or "Gold/Black · Do not disturb" for a product with styles.
export function lookLabel(product: Product, look: ResolvedLook): string {
  const colour = colourOf(product, look.colour).name;
  return productStyles(product).length > 0
    ? `${colour} · ${styleName(product, look.style)}`
    : colour;
}

// The product's text in a colour: the colour's own name, material and things
// never shown where it has them (a product whose text names its colours),
// else the product's.
function textInColour(
  product: Product,
  key: string,
): Pick<Product, "name" | "material" | "forbidden"> {
  const colour = product.colours.find((c) => c.key === key);
  return {
    name: colour?.productName ?? product.name,
    material: colour?.material ?? product.material,
    forbidden: colour?.forbidden ?? product.forbidden,
  };
}

// The product in a look: that colour as its default, with its own text, and
// that style's drawing and wording. `design` is the drawing already redrawn
// in the look's colour (drawLook), so a plate rendered from the result is in
// that colour. Every reader of the product (its understanding, its sample,
// its scene cues, the view from above, the exact frames) then follows the
// look.
export function productInLook(
  product: Product,
  look: ResolvedLook,
  design?: string,
): Product {
  const style = look.style
    ? productStyles(product).find((s) => s.key === look.style)
    : undefined;
  const wording = style?.examples
    ? product.wording.map((line, i) => {
        // A line left out or empty shows the product's example.
        const example = style.examples?.[i]?.trim();
        return example ? { ...line, example } : line;
      })
    : product.wording;
  const text = textInColour(product, look.colour);
  if (product.source.kind !== "vector") {
    return { ...product, ...text, defaultColour: look.colour, wording };
  }
  // A style's drawing keeps its own outline; its scale is not the source's.
  const { outlineBox, scalePxPerUnit, ...rest } = product.source;
  const box = style ? style.outlineBox : outlineBox;
  return {
    ...product,
    ...text,
    defaultColour: look.colour,
    wording,
    source: {
      ...rest,
      svgUrl: design ?? style?.svgUrl ?? product.source.svgUrl,
      ...(!style && scalePxPerUnit ? { scalePxPerUnit } : {}),
      ...(box ? { outlineBox: box } : {}),
    },
  };
}
