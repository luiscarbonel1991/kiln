import { Resvg } from "@resvg/resvg-js";
import type { PlateRequest, PlateResult, Product } from "@/domain/product";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import type { PlateRenderer } from "@/providers/interfaces";

// Generic plate renderer for vector products (Product.source.kind === "vector"):
// the product IS an SVG (traced line art, a drawn design, an exported cut file).
// Every piece of the request repeats that SVG; wording is not typeset here
// (vector products carry their lettering as geometry), so expectedText is what
// the request declared, for the QC gate to compare against the trace's origin.
// Output: an opaque square PNG on a flat ground, the layout fitted to 86 % of
// the card on BOTH axes, rasterized with resvg (no browser, no system deps).

const FIT = 0.86;
const GAP = 0.03;

export interface SvgBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Reads the drawing's own box from viewBox, else width/height (px or unitless).
export function svgBox(svg: string): SvgBox {
  const vb = svg.match(
    /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i,
  );
  if (vb) {
    return { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] };
  }
  const w = svg.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)(px)?["']/i);
  const h = svg.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)(px)?["']/i);
  if (w && h) return { x: 0, y: 0, w: +w[1], h: +h[1] };
  throw new Error("SVG has neither a viewBox nor px width/height");
}

// Wraps n copies of the drawing in a square document: ground rect + one nested
// <svg> per piece, laid out single / row / stack. Returns the document and the
// pixel boxes, so the PNG and the QC hints come from the same numbers.
export function composePlateSvg(
  svg: string,
  box: SvgBox,
  request: PlateRequest,
): { doc: string; boxes: SvgBox[]; scale: number } {
  const n = request.pieces.length;
  const S = request.sizePx;
  const target = S * FIT;
  const gap = request.layout === "single" ? 0 : Math.round(S * GAP);
  const scale =
    request.layout === "row"
      ? Math.min((target - (n - 1) * gap) / (box.w * n), target / box.h)
      : request.layout === "stack"
        ? Math.min(target / box.w, (target - (n - 1) * gap) / (box.h * n))
        : Math.min(target / box.w, target / box.h);
  const pw = box.w * scale;
  const ph = box.h * scale;
  const totalW = request.layout === "row" ? pw * n + gap * (n - 1) : pw;
  const totalH = request.layout === "stack" ? ph * n + gap * (n - 1) : ph;
  const x0 = (S - totalW) / 2;
  const y0 = (S - totalH) / 2;
  const boxes: SvgBox[] = [];
  const inner = svg
    .replace(/<\?xml[^>]*>/i, "")
    .replace(/<!DOCTYPE[^>]*>/i, "");
  const pieces = request.pieces
    .map((_, i) => {
      const x = request.layout === "row" ? x0 + i * (pw + gap) : x0;
      const y = request.layout === "stack" ? y0 + i * (ph + gap) : y0;
      boxes.push({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(pw),
        h: Math.round(ph),
      });
      const nested = inner.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
        const cleaned = attrs
          .replace(/\s(x|y|width|height)\s*=\s*["'][^"']*["']/gi, "")
          .replace(/\sviewBox\s*=\s*["'][^"']*["']/i, "");
        return `<svg${cleaned} x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${pw.toFixed(2)}" height="${ph.toFixed(2)}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">`;
      });
      return nested;
    })
    .join("\n");
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="${request.ground}"/>${pieces}</svg>`;
  return { doc, boxes, scale };
}

export function rasterize(doc: string, sizePx: number): Uint8Array {
  const r = new Resvg(doc, { fitTo: { mode: "width", value: sizePx } });
  return r.render().asPng();
}

export const svgPlateRenderer: PlateRenderer = {
  id: "svg",
  version: "1",
  async render({
    product,
    request,
  }: {
    product: Product;
    request: PlateRequest;
  }): Promise<PlateResult> {
    if (product.source.kind !== "vector") {
      throw new Error(
        `svg plate renderer needs a vector product, got "${product.source.kind}"`,
      );
    }
    const { bytes, mime } = await fetchAsset(product.source.svgUrl);
    if (
      !/svg/.test(mime) &&
      !bytes.subarray(0, 512).toString("utf8").includes("<svg")
    ) {
      throw new Error(`not an SVG: ${product.source.svgUrl} (${mime})`);
    }
    const svg = bytes.toString("utf8");
    const box = svgBox(svg);
    const { doc, boxes, scale } = composePlateSvg(svg, box, request);
    const png = rasterize(doc, request.sizePx);
    const assetUrl = await storeAsset(png, "image/png", "plates");
    const svgUrl = await storeAsset(
      Buffer.from(doc, "utf8"),
      "image/svg+xml",
      "plates",
    );
    // ppi: pixels per product unit. With a calibration (px of the drawing per unit)
    // it is exact; without one it falls back to the declared width.
    const unitsPerDrawingPx = product.source.scalePxPerUnit
      ? 1 / product.source.scalePxPerUnit
      : product.dimensions.w / box.w;
    const ppi = scale / unitsPerDrawingPx;
    return {
      productId: product.id,
      assetUrl,
      svgUrl,
      mime: "image/png",
      sizePx: request.sizePx,
      ppi,
      pieces: request.pieces.map((p, i) => ({
        bbox: boxes[i],
        expectedText: p.wording.filter((t) => t.trim() !== ""),
        colour: p.colour,
        ...(p.icon ? { icon: p.icon } : {}),
      })),
      renderer: { id: "svg", version: "1" },
      request,
    };
  },
};
