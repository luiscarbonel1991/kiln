import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import {
  compareLetterforms,
  inkComponents,
  type Letterform,
  letterform,
  type RgbaImage,
  stackedRun,
} from "@/domain/qc-pixels";

const FONTS = ["HankenGrotesk-Regular.ttf", "HankenGrotesk-Bold.ttf"].map((f) =>
  join(process.cwd(), "assets", "fonts", f),
);

function image(body: string, size = 512, ground = "#e9e4dc"): RgbaImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${ground}"/>${body}</svg>`;
  const out = new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: false },
  }).render();
  return { width: out.width, height: out.height, pixels: out.pixels };
}

const glyphs = (
  text: string,
  x: number,
  y: number,
  size: number,
  { weight = 400, fill = "#1b1b1b" } = {},
) =>
  `<text x="${x}" y="${y}" font-family="Hanken Grotesk" font-weight="${weight}" font-size="${size}" fill="${fill}">${text}</text>`;

// The ink box of a rendered line, found the way OCR would hand it over.
function inkBox(img: RgbaImage, ink: string) {
  const parts = inkComponents(img, ink).filter((c) => c.area > 20);
  const x = Math.min(...parts.map((c) => c.x));
  const y = Math.min(...parts.map((c) => c.y));
  const right = Math.max(...parts.map((c) => c.x + c.w));
  const bottom = Math.max(...parts.map((c) => c.y + c.h));
  const pad = 6;
  return {
    x: x - pad,
    y: y - pad,
    w: right - x + 2 * pad,
    h: bottom - y + 2 * pad,
  };
}

describe("stackedRun", () => {
  it("finds one character per piece stacked in a column, past a dark block beside it", () => {
    const img = image(
      `${glyphs("2", 130, 150, 100)}${glyphs("0", 130, 290, 100)}${glyphs("5", 130, 430, 100)}<rect x="360" y="260" width="120" height="200" fill="#1b1b1b"/>`,
    );
    const run = stackedRun(inkComponents(img, "#1B1B1B"), 3, img.height);
    expect(run).toHaveLength(3);
    expect(run?.map((c) => c.y)).toEqual(
      [...(run ?? [])].map((c) => c.y).sort((a, b) => a - b),
    );
    for (const c of run ?? []) expect(c.x).toBeLessThan(250);
  });

  it("finds no stack in a row of characters, nor more pieces than there are", () => {
    const row = image(glyphs("205", 120, 300, 120));
    expect(stackedRun(inkComponents(row, "#1B1B1B"), 3, row.height)).toBeNull();
    const two = image(
      `${glyphs("2", 130, 180, 100)}${glyphs("0", 130, 320, 100)}`,
    );
    expect(stackedRun(inkComponents(two, "#1B1B1B"), 3, two.height)).toBeNull();
    expect(stackedRun([], 1, 512)).toBeNull();
  });
});

describe("letterform", () => {
  const measure = (img: RgbaImage, ink: string) =>
    letterform(img, inkBox(img, ink)) as Letterform;

  it("reads the same stroke and width at any size", () => {
    const big = measure(image(glyphs("205", 60, 330, 200)), "#1B1B1B");
    const small = measure(image(glyphs("205", 150, 300, 90)), "#1B1B1B");
    expect(Math.abs(small.stroke / big.stroke - 1)).toBeLessThan(0.15);
    expect(Math.abs(small.width / big.width - 1)).toBeLessThan(0.1);
    expect(big.height).toBeGreaterThan(small.height * 2);
  });

  it("measures light letters on a dark face as it does dark on light", () => {
    const dark = measure(image(glyphs("205", 90, 320, 160)), "#1B1B1B");
    const light = measure(
      image(glyphs("205", 90, 320, 160, { fill: "#f4f1ea" }), 512, "#1b1b1b"),
      "#F4F1EA",
    );
    expect(Math.abs(light.stroke / dark.stroke - 1)).toBeLessThan(0.15);
    expect(Math.abs(light.width / dark.width - 1)).toBeLessThan(0.1);
  });

  // Light engraving on a dark, textured face (slate, 2026-11-12): three real
  // takes that read well failed on a stroke the texture had thinned.
  const DARK = "#1b1b1b";
  const LIGHT = "#d9d6cf";
  const engraved = (extra = "") =>
    image(`${glyphs("205", 90, 320, 160, { fill: LIGHT })}${extra}`, 512, DARK);
  const roomy = (img: RgbaImage) => {
    const box = inkBox(engraved(), "#D9D6CF");
    const pad = 26;
    return letterform(img, {
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + 2 * pad,
      h: box.h + 2 * pad,
    }) as Letterform;
  };

  it("does not count specks of the ground around the letters as ink", () => {
    const clean = roomy(engraved());
    const box = inkBox(engraved(), "#D9D6CF");
    const specks = Array.from({ length: 24 }, (_, i) => {
      const x = box.x + 10 + i * ((box.w - 20) / 23);
      const y = i % 2 === 0 ? box.y - 18 : box.y + box.h + 18;
      return `<circle cx="${x}" cy="${y}" r="2.5" fill="${LIGHT}"/>`;
    }).join("");
    const speckled = roomy(engraved(specks));
    expect(speckled.height).toBe(clean.height);
    expect(Math.abs(speckled.stroke / clean.stroke - 1)).toBeLessThan(0.05);
    expect(Math.abs(speckled.width / clean.width - 1)).toBeLessThan(0.05);
  });

  it("reads a stroke whole through the grain a close shot shows inside it", () => {
    const clean = roomy(engraved());
    const box = inkBox(engraved(), "#D9D6CF");
    const grain: string[] = [];
    for (let y = box.y; y < box.y + box.h; y += 5) {
      for (let x = box.x + (y % 2) * 3; x < box.x + box.w; x += 5) {
        grain.push(`<circle cx="${x}" cy="${y}" r="1.4" fill="${DARK}"/>`);
      }
    }
    const grainy = roomy(engraved(grain.join("")));
    expect(Math.abs(grainy.stroke / clean.stroke - 1)).toBeLessThan(0.2);
    expect(Math.abs(grainy.width / clean.width - 1)).toBeLessThan(0.05);
  });

  it("is null for a box with nothing to read", () => {
    const blank = image("");
    expect(letterform(blank, { x: 10, y: 10, w: 200, h: 80 })).toBeNull();
    expect(letterform(blank, { x: 10, y: 10, w: 2, h: 2 })).toBeNull();
  });
});

describe("compareLetterforms", () => {
  const measure = (weight: number, size: number) => {
    const img = image(glyphs("205", 80, 330, size, { weight }));
    return letterform(img, inkBox(img, "#1B1B1B")) as Letterform;
  };

  it("passes the same font at another size and fails a heavier weight", () => {
    const reference = measure(400, 180);
    expect(compareLetterforms(measure(400, 110), reference)).toMatchObject({
      strokeOk: true,
      widthOk: true,
    });
    const bold = compareLetterforms(measure(700, 180), reference);
    expect(bold?.strokeOk).toBe(false);
    expect(bold?.take.stroke).toBeGreaterThan(bold?.reference.stroke ?? 1);
  });

  it("passes the same font seen from above, where the letters are shorter", () => {
    const reference = measure(400, 180);
    const img = image(
      `<g transform="translate(0 90) scale(1 0.72)">${glyphs("205", 80, 330, 180)}</g>`,
    );
    const above = letterform(img, inkBox(img, "#1B1B1B")) as Letterform;
    // Shorter letters: stroke and width both grow against the height.
    expect(above.stroke / reference.stroke).toBeGreaterThan(1.25);
    expect(compareLetterforms(above, reference)?.strokeOk).toBe(true);
    const boldImg = image(
      `<g transform="translate(0 90) scale(1 0.72)">${glyphs("205", 80, 330, 180, { weight: 700 })}</g>`,
    );
    const boldAbove = letterform(
      boldImg,
      inkBox(boldImg, "#1B1B1B"),
    ) as Letterform;
    expect(compareLetterforms(boldAbove, reference)?.strokeOk).toBe(false);
  });

  it("does not compare letters too small for their stroke to be told apart", () => {
    const reference = measure(400, 180);
    expect(
      compareLetterforms({ ...reference, height: 20 }, reference),
    ).toBeNull();
    expect(
      compareLetterforms({ ...reference, height: 40 }, reference),
    ).not.toBeNull();
  });
});
