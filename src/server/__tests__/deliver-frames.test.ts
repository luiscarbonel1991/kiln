import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { exactView } from "@/domain/exact";
import { parseProductPackage } from "@/lib/product-package";
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
