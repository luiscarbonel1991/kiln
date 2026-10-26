import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { sizeSpecLayout } from "@/components/projects/size-spec-layout";
import { exactView } from "@/domain/exact";
import { parseProductPackage } from "@/domain/product-package";
import {
  EXPORT_FONT_OPTIONS,
  exactFrameSvg,
  renderExactPng,
  targetSize,
  upscaleScene,
} from "@/server/deliver/frames";
import pkg from "../../lib/__fixtures__/product-package.json";

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");
const [board, coaster] = parsed.products;

// A PNG's size, from its IHDR chunk.
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const ETSY = {
  formats: [
    { key: "square", label: "Square", aspect: "1:1", minPx: 2000 },
    { key: "portrait", label: "Portrait", aspect: "4:5", minPx: 2000 },
  ],
};

describe("targetSize", () => {
  it("puts the destination's pixel target on the short side", () => {
    expect(targetSize("1:1", ETSY)).toEqual({ width: 2000, height: 2000 });
    expect(targetSize("4:5", ETSY)).toEqual({ width: 2000, height: 2500 });
    expect(targetSize("3:2", ETSY)).toEqual({ width: 3000, height: 2000 });
    expect(targetSize(undefined, { formats: [] })).toEqual({
      width: 2000,
      height: 2000,
    });
  });
});

describe("exact frames to files", () => {
  it("renders a frame at the target width, its aspect kept", () => {
    const svg = exactFrameSvg(exactView("colour-grid", board), "4:5", null);
    expect(pngSize(renderExactPng(svg, 2000))).toEqual({
      width: 2000,
      height: 2500,
    });
  });

  it("a colour with a material sample shows its photo, not a flat fill", () => {
    const red = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff0000"/></svg>`,
    )
      .render()
      .asPng();
    const sampled = {
      ...board,
      colours: board.colours.map((c, i) =>
        i === 0
          ? {
              ...c,
              swatchUrl: `data:image/png;base64,${Buffer.from(red).toString("base64")}`,
            }
          : c,
      ),
    };
    const redPixels = (product: typeof board) => {
      const svg = exactFrameSvg(exactView("colour-grid", product), "1:1", null);
      const { pixels } = new Resvg(svg).render();
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60) n++;
      }
      return { svg, n };
    };
    const shown = redPixels(sampled);
    expect(shown.svg).toContain("<pattern");
    expect(shown.n).toBeGreaterThan(500);
    expect(redPixels(board).n).toBe(0);
  });

  it("names real fonts the vendored files provide", () => {
    const svg = exactFrameSvg(exactView("size-spec", coaster), "1:1", null);
    expect(svg).toContain("font-family:Fraunces");
    expect(svg).not.toContain("var(--font");
    const text = (family: string, style = "normal") =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><text x="10" y="40" style="font-family:${family};font-size:24px;font-style:${style}">Kiln</text></svg>`;
    const bbox = (svgText: string) =>
      new Resvg(svgText, {
        font: { ...EXPORT_FONT_OPTIONS, loadSystemFonts: false },
      }).getBBox();
    for (const [family, style] of [
      ["Fraunces", "italic"],
      ["Fraunces", "normal"],
      ["Hanken Grotesk", "normal"],
      ["JetBrains Mono", "normal"],
    ]) {
      expect(bbox(text(family, style))?.width ?? 0).toBeGreaterThan(20);
    }
  });
});

describe("Size & spec with the real fonts", () => {
  it("every fact line the layout keeps fits the frame in Hanken Grotesk", () => {
    const view = exactView("size-spec", {
      ...coaster,
      shape: "rounded rectangle keychain tag",
      material: "3 mm birch plywood, natural wood grain, laser cut by hand",
    });
    if (view.kind !== "size-spec") throw new Error();
    const layout = sizeSpecLayout({
      width: 400,
      height: 400,
      product: { width: view.width, height: view.height },
      heightLabel: `${view.height} ${view.unit}`,
      facts: view.facts,
      depth: view.depth !== undefined,
    });
    const width = (line: string, size: number) =>
      new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 60"><text x="0" y="40" style="font-family:Hanken Grotesk;font-size:${size}px">${line}</text></svg>`,
        { font: { ...EXPORT_FONT_OPTIONS, loadSystemFonts: false } },
      ).getBBox()?.width ?? 0;
    const lines = layout.rows.flatMap((r) => r.value);
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect(layout.valueX + width(line, layout.fontSize)).toBeLessThanOrEqual(
        392,
      );
    }
  });
});

const hasMagick = (() => {
  try {
    execFileSync("magick", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

// Upscales with ImageMagick: slow on a busy machine.
describe.skipIf(!hasMagick)("scenes to files", { timeout: 30_000 }, () => {
  it("cover-crops a 2:3 output to its 4:5 slot at 2000 x 2500", async () => {
    const source = execFileSync("magick", [
      "-size",
      "1024x1536",
      "gradient:#C46A47-#355E3B",
      "png:-",
    ]);
    const jpg = await upscaleScene(source, { width: 2000, height: 2500 });
    const size = execFileSync(
      "magick",
      ["identify", "-format", "%w %h %m", "-"],
      {
        input: jpg,
      },
    ).toString();
    expect(size).toBe("2000 2500 JPEG");
  });
});
