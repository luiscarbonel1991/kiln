import { colourOf, type Product, type ProductPart } from "@/domain/product";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import {
  FIT,
  measureOutline,
  nestSvg,
  rasterize,
  type SvgBox,
  svgBox,
} from "@/providers/plates/svg";

// The product seen from a little above, drawn locally from its front drawing
// and its parts: an image model editing a reference keeps its viewpoint, so a
// scene edited from this one shows the top of a part lying flat (a base) that
// a front view only shows edge-on. Orthographic, the camera pitched down by
// θ: the upright part's face is its drawing squashed by cos θ, with its top
// edge above it; the flat part's top is its footprint (rounded by its corner)
// squashed by sin θ, its sides dropping below. The drawing does not say which
// pixels are which part: its bottom band, the flat part's height, is taken as
// the flat part's front and the rest as the upright part, which stands in the
// middle of the flat part's depth.

const TOLERANCE = 0.03;
const GROUND = "#F0EEE9";

export interface StandingLayout {
  upright: ProductPart;
  flat: ProductPart;
}

// The two parts as one upright part standing on one flat part, or why the
// product cannot be drawn so.
export function standingLayout(
  product: Product,
): StandingLayout | { refusal: string } {
  const parts = product.parts ?? [];
  if (parts.length !== 2) {
    return { refusal: "it needs exactly two parts" };
  }
  const [upright, flat] = parts;
  if (upright.lies !== "upright" || flat.lies !== "flat") {
    return {
      refusal: "its main part must stand upright on a part lying flat",
    };
  }
  const { w, h } = product.dimensions;
  const stacked = upright.dimensions.h + flat.dimensions.h;
  if (Math.abs(stacked - h) > TOLERANCE * h) {
    return {
      refusal: `its parts stack to ${stacked} high, not its ${h}`,
    };
  }
  const widths = [upright.dimensions.w, flat.dimensions.w];
  if (
    Math.max(...widths) > (1 + TOLERANCE) * w ||
    Math.max(...widths) < (1 - TOLERANCE) * w
  ) {
    return { refusal: `its parts are not ${w} across at their widest` };
  }
  if (flat.dimensions.d <= upright.dimensions.d) {
    return {
      refusal: "the part lying flat must be deeper than the part on it",
    };
  }
  return { upright, flat };
}

export interface ThreeQuarterOptions {
  angleDeg?: number;
  sizePx?: number;
  ground?: string;
}

export interface ThreeQuarterGeometry {
  // Pixels per product unit.
  scale: number;
  // The upright part's face, in px.
  face: SvgBox;
  // How tall its top edge shows, in px.
  rim: number;
  // The flat part's top, in px, with its corners' radii.
  top: SvgBox & { rx: number; ry: number };
  // How far the flat part's sides drop, in px.
  wall: number;
  // The whole product, in px.
  bounds: SvgBox;
  // The upright part's region of the drawing, in its own units.
  band: SvgBox;
}

// Where each part lands, from the drawn box (in the drawing's units) and the
// parts' sizes.
export function threeQuarterGeometry(
  drawn: SvgBox,
  product: Product,
  layout: StandingLayout,
  options: Required<ThreeQuarterOptions>,
): ThreeQuarterGeometry {
  const theta = (options.angleDeg * Math.PI) / 180;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const H = product.dimensions.h;
  const k = drawn.h / H;
  const W = drawn.w / k;
  const up = layout.upright.dimensions;
  const flat = layout.flat.dimensions;
  const radius = Math.min(layout.flat.corner ?? 0, flat.w / 2, flat.d / 2);
  // Screen units: u across, v down; v = z sin θ − y cos θ, with z toward the
  // camera from the middle of the flat part's depth and y up from the floor.
  const faceTop = (up.d / 2) * sin - H * cos;
  const faceBottom = (up.d / 2) * sin - flat.h * cos;
  const rim = up.d * sin;
  const topLeft = W / 2 - flat.w / 2;
  const topTop = -flat.h * cos - (flat.d / 2) * sin;
  const minU = Math.min(0, topLeft);
  const maxU = Math.max(W, topLeft + flat.w);
  const minV = Math.min(faceTop - rim, topTop);
  const maxV = (flat.d / 2) * sin;
  const S = options.sizePx;
  const scale = Math.min((S * FIT) / (maxU - minU), (S * FIT) / (maxV - minV));
  const x0 = (S - (maxU - minU) * scale) / 2 - minU * scale;
  const y0 = (S - (maxV - minV) * scale) / 2 - minV * scale;
  const px = (u: number, v: number) => ({
    x: x0 + u * scale,
    y: y0 + v * scale,
  });
  const face = px(0, faceTop);
  const top = px(topLeft, topTop);
  const corner = px(minU, minV);
  return {
    scale,
    face: {
      x: face.x,
      y: face.y,
      w: W * scale,
      h: (faceBottom - faceTop) * scale,
    },
    rim: rim * scale,
    top: {
      x: top.x,
      y: top.y,
      w: flat.w * scale,
      h: flat.d * sin * scale,
      rx: radius * scale,
      ry: radius * sin * scale,
    },
    wall: flat.h * cos * scale,
    bounds: {
      x: corner.x,
      y: corner.y,
      w: (maxU - minU) * scale,
      h: (maxV - minV) * scale,
    },
    band: {
      x: drawn.x,
      y: drawn.y,
      w: drawn.w,
      h: drawn.h - flat.h * k,
    },
  };
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex: string, toward: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(toward);
  return `#${a
    .map((c, i) =>
      Math.round(c + (b[i] - c) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

// The flat part's top and sides, and the upright part's top edge: their own
// fixed colours, else the product's default colour; a cut edge in the edge
// colour; a dark top a shade lighter than its sides, so the top reads as one.
function colours(product: Product, layout: StandingLayout) {
  const c = colourOf(product, product.defaultColour);
  const flatHex = layout.flat.colour?.hex ?? c.face;
  const flatEdge = layout.flat.colour ? undefined : c.edge;
  const dark = luminance(flatHex) < 0.25;
  const uprightHex = layout.upright.colour?.hex ?? c.face;
  return {
    top: dark ? mix(flatHex, "#ffffff", 0.15) : flatHex,
    sides: flatEdge ?? (dark ? flatHex : mix(flatHex, "#000000", 0.22)),
    rim:
      (layout.upright.colour ? undefined : c.edge) ??
      mix(uprightHex, "#000000", 0.25),
  };
}

const f = (n: number) => n.toFixed(2);

// The document, or null when the product cannot be drawn from above (its
// parts do not stand so, or its drawing does not match its size).
export function threeQuarterPlateSvg(
  svg: string,
  product: Product,
  options: ThreeQuarterOptions = {},
): { doc: string; geometry: ThreeQuarterGeometry } | null {
  const o = {
    angleDeg: options.angleDeg ?? 30,
    sizePx: options.sizePx ?? 1024,
    ground: options.ground ?? GROUND,
  };
  if (o.angleDeg < 10 || o.angleDeg > 45) {
    throw new Error(
      `a view from above takes 10 to 45 degrees, not ${o.angleDeg}`,
    );
  }
  const layout = standingLayout(product);
  if ("refusal" in layout) return null;
  const outline = measureOutline(
    svg,
    product.dimensions,
    product.source.kind === "vector"
      ? product.source.scalePxPerUnit
      : undefined,
  );
  if ("mismatch" in outline) return null;
  const frame = svgBox(svg);
  const drawn = {
    x: frame.x + outline.box.x * frame.w,
    y: frame.y + outline.box.y * frame.h,
    w: outline.box.w * frame.w,
    h: outline.box.h * frame.h,
  };
  const g = threeQuarterGeometry(drawn, product, layout, o);
  const paint = colours(product, layout);
  const { top, face } = g;
  const S = o.sizePx;
  const pill = (dy: number) =>
    `<rect x="${f(top.x)}" y="${f(top.y + dy)}" width="${f(top.w)}" height="${f(top.h)}" rx="${f(top.rx)}" ry="${f(top.ry)}"/>`;
  const rimAt = { ...face, y: face.y - g.rim };
  const doc = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    `<defs>`,
    `<clipPath id="kiln-face"><rect x="${f(face.x)}" y="${f(face.y)}" width="${f(face.w)}" height="${f(face.h)}"/></clipPath>`,
    `<clipPath id="kiln-rim"><rect x="${f(rimAt.x)}" y="${f(rimAt.y)}" width="${f(rimAt.w)}" height="${f(rimAt.h)}"/></clipPath>`,
    `<filter id="kiln-rim-fill" color-interpolation-filters="sRGB"><feFlood flood-color="${paint.rim}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`,
    `</defs>`,
    `<rect width="${S}" height="${S}" fill="${o.ground}"/>`,
    `<g fill="${paint.sides}">`,
    `<rect x="${f(top.x)}" y="${f(top.y + top.h / 2)}" width="${f(top.w)}" height="${f(g.wall)}"/>`,
    pill(g.wall),
    `</g>`,
    `<g fill="${paint.top}">${pill(0)}</g>`,
    `<g clip-path="url(#kiln-rim)" filter="url(#kiln-rim-fill)">${nestSvg(svg, rimAt, g.band, "none")}</g>`,
    `<g clip-path="url(#kiln-face)">${nestSvg(svg, face, g.band, "none")}</g>`,
    `</svg>`,
  ].join("");
  return { doc, geometry: g };
}

// The view from above as a stored PNG, or null when the product cannot be
// drawn so (not a vector product, or its parts or drawing do not fit).
export async function renderThreeQuarter(
  product: Product,
  options: ThreeQuarterOptions = {},
): Promise<{ assetUrl: string; mime: "image/png"; angleDeg: number } | null> {
  if (product.source.kind !== "vector") return null;
  if ("refusal" in standingLayout(product)) return null;
  const { bytes, mime } = await fetchAsset(product.source.svgUrl);
  const svg = bytes.toString("utf8");
  if (!/svg/.test(mime) && !svg.slice(0, 512).includes("<svg")) return null;
  const drawn = threeQuarterPlateSvg(svg, product, options);
  if (!drawn) return null;
  const sizePx = options.sizePx ?? 1024;
  const png = rasterize(drawn.doc, sizePx);
  const assetUrl = await storeAsset(png, "image/png", "plates", {
    byContent: true,
  });
  return { assetUrl, mime: "image/png", angleDeg: options.angleDeg ?? 30 };
}
