import type { ColourOption, Product } from "@/domain/product";

// A design redrawn in another of its product's colours, free: a maker's drawing
// paints exactly its colour's face, edge and marks, so swapping those hexes for
// another colour's draws the same product in that colour. Paints that are not
// the colour's (a part in a fixed colour, a strip, a shadow) stay as drawn.

// A paint in an attribute (fill="#1B1B1B") or a style declaration
// (fill:#1B1B1B), six or three digits.
const PAINT =
  /((?:fill|stroke|stop-color|flood-color|lighting-color)\s*(?:=\s*["']\s*|:\s*))(#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F]))/gi;

const normal = (hex: string) => {
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? [...digits].map((d) => d + d).join("")
      : digits.slice(0, 6);
  return `#${full.toUpperCase()}`;
};

export function paintColours(svg: string): Set<string> {
  return new Set([...svg.matchAll(PAINT)].map((m) => normal(m[2])));
}

// The colour a drawing is painted in: the default colour when its face is
// painted, else the first colour whose face is, else null (the drawing
// paints none of them, and Kiln cannot tell what to swap).
export function drawnIn(svg: string, product: Product): ColourOption | null {
  const paints = paintColours(svg);
  const painted = (c: ColourOption) => paints.has(normal(c.face));
  const preferred = product.colours.find(
    (c) => c.key === product.defaultColour,
  );
  if (preferred && painted(preferred)) return preferred;
  return product.colours.find(painted) ?? null;
}

// The drawing in `to`: each of `from`'s face, marks (inlay) and edge becomes
// `to`'s, in one pass, so two colours that trade hexes (a dark face with
// light marks, and a light face with dark marks) never swap twice.
export function recolourSvg(
  svg: string,
  from: ColourOption,
  to: ColourOption,
): string {
  const swaps = new Map<string, string>();
  const pair = (a: string | undefined, b: string | undefined) => {
    if (a && b && !swaps.has(normal(a))) swaps.set(normal(a), normal(b));
  };
  pair(from.face, to.face);
  pair(from.inlay, to.inlay);
  pair(from.edge, to.edge);
  return svg.replace(PAINT, (whole, lead: string, hex: string) => {
    const swapped = swaps.get(normal(hex));
    return swapped ? `${lead}${swapped}` : whole;
  });
}
