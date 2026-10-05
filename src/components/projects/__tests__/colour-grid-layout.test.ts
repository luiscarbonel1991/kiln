import { describe, expect, it } from "vitest";
import {
  colourGridLayout,
  textWidth,
  wrapName,
} from "@/components/projects/colour-grid-layout";

// Eight real-length colour names (the review's live product had names like
// these; the fixtures' two or three short ones hid the overlap).
const LONG = [
  "Matte Hunter Green",
  "Matte Terra Cotta",
  "Glossy Midnight Blue",
  "Speckled Oatmeal White",
  "Matte Charcoal Black",
  "Satin Dusty Rose",
  "Gloss Ocean Teal",
  "Matte Champagne Gold",
];
const STOCK = LONG.map((_n, i) => i !== 7);

function check(height: number, names = LONG, inStock = STOCK) {
  const layout = colourGridLayout({
    names,
    inStock,
    width: 400,
    height,
    top: 100,
  });
  const descent = layout.fontSize * 0.3;
  const bottom = (c: (typeof layout.cells)[number]) =>
    (c.stockY ?? c.nameY + (c.lines.length - 1) * layout.lineHeight) + descent;
  for (const [i, a] of layout.cells.entries()) {
    // Inside the frame.
    expect(a.cx - layout.pitch / 2).toBeGreaterThanOrEqual(0);
    expect(a.cx + layout.pitch / 2).toBeLessThanOrEqual(400);
    expect(bottom(a)).toBeLessThanOrEqual(height);
    for (const b of layout.cells.slice(i + 1)) {
      if (b.swatchY === a.swatchY) {
        // Same row: the names never touch sideways.
        const widest = (c: typeof a) =>
          Math.max(...c.lines.map((l) => textWidth(l, layout.fontSize)));
        expect(Math.abs(b.cx - a.cx)).toBeGreaterThanOrEqual(
          (widest(a) + widest(b)) / 2,
        );
      } else {
        // A later row starts below this row's names and stock note.
        expect(b.swatchY).toBeGreaterThan(bottom(a));
      }
    }
  }
  return layout;
}

describe("colourGridLayout", () => {
  it("eight long names fit a square frame: wrapped, readable, no overlap", () => {
    const layout = check(400);
    expect(layout.fontSize).toBeGreaterThanOrEqual(11);
    expect(layout.swatch).toBeGreaterThanOrEqual(36);
    expect(layout.cells.some((c) => c.lines.length === 2)).toBe(true);
  });

  it("and a 4:5 frame, with bigger swatches", () => {
    const square = check(400);
    const tall = check(500);
    expect(tall.swatch).toBeGreaterThanOrEqual(square.swatch);
  });

  it("two or three short names keep one row of large swatches", () => {
    const layout = check(
      400,
      ["Maple", "Walnut", "Cherry"],
      [true, true, false],
    );
    expect(layout.cols).toBe(3);
    expect(layout.cells.every((c) => c.lines.length === 1)).toBe(true);
    expect(layout.swatch).toBeGreaterThanOrEqual(80);
  });

  it("even twenty colours stay inside the frame", () => {
    const many = Array.from({ length: 20 }, (_n, i) => `Colour number ${i}`);
    check(
      500,
      many,
      many.map(() => true),
    );
  });
});

describe("wrapName", () => {
  it("breaks at the space nearest the middle, or refuses", () => {
    expect(wrapName("Speckled Oatmeal White", 110, 14)).toEqual([
      "Speckled",
      "Oatmeal White",
    ]);
    expect(wrapName("Maple", 90, 14)).toEqual(["Maple"]);
    expect(wrapName("Supercalifragilistic", 60, 14)).toBeNull();
  });
});
