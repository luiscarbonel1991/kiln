import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { productColours } from "@/lib/photo-colours";
import { colourName, svgColours } from "@/lib/product-form";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import {
  fetchAsset,
  isAllowedAssetUrl,
  storeAsset,
} from "@/providers/asset-bytes";
import { measureDrawing } from "@/providers/plates/svg";

const execFileP = promisify(execFile);

// A product's file (the New project form): a photo of the piece, or the SVG of
// its design. Stored in Kiln's storage (so it passes the asset allowlist), with
// what the form can prefill for free: the colours it shows and, for a design,
// the drawing's proportions.

export type StoredProductFile =
  | {
      kind: "photo";
      url: string;
      colours: { name: string; hex: string }[];
    }
  | {
      kind: "vector";
      url: string;
      colours: { name: string; hex: string }[];
      // The drawing's size in its own pixels: height = width / ratio.
      drawnWidthPx: number;
      ratio: number;
    };

export class ProductFileRefused extends Error {
  readonly name = "ProductFileRefused";
}

const named = (hexes: string[]) =>
  hexes.map((hex) => ({ name: colourName(hex), hex }));

// The size the photo is read at: enough to tell a piece from its background.
const COLOUR_SIZE = 48;

// A photo's product colours: its pixels at a small size (ImageMagick, already
// a system dependency), read from the centre without the background
// (productColours).
export async function photoColours(
  bytes: Uint8Array,
  max = 4,
): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-colours-"));
  try {
    const src = join(dir, "in");
    await writeFile(src, bytes);
    const { stdout } = await execFileP(
      "magick",
      [
        src,
        "-auto-orient",
        "-resize",
        `${COLOUR_SIZE}x${COLOUR_SIZE}!`,
        "-depth",
        "8",
        "rgb:-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20 },
    );
    if (stdout.length < COLOUR_SIZE * COLOUR_SIZE * 3) return [];
    return productColours(new Uint8Array(stdout), COLOUR_SIZE, max);
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function storeProductPhoto(
  bytes: Uint8Array,
  mime: string,
): Promise<StoredProductFile> {
  const url = await storeAsset(bytes, mime, "products");
  return { kind: "photo", url, colours: named(await photoColours(bytes)) };
}

export async function storeProductSvg(
  text: string,
): Promise<StoredProductFile> {
  const svg = sanitizeSvg(text);
  if (!svg) throw new ProductFileRefused("That file is not an SVG drawing.");
  let drawn: { width: number; height: number } | null;
  try {
    drawn = measureDrawing(svg);
  } catch {
    throw new ProductFileRefused("That SVG could not be read.");
  }
  if (!drawn) throw new ProductFileRefused("That SVG draws nothing.");
  const url = await storeAsset(
    new TextEncoder().encode(svg),
    "image/svg+xml",
    "products",
  );
  return {
    kind: "vector",
    url,
    colours: named(svgColours(svg, 4)),
    drawnWidthPx: drawn.width,
    ratio: drawn.width / drawn.height,
  };
}

// A design already in Kiln's storage (a vectorized line-art card, handed over
// by "Make it a product"), described like an upload; null when the address is
// not a stored SVG or it cannot be read.
export async function describeStoredSvg(
  url: string,
): Promise<StoredProductFile | null> {
  if (
    url.startsWith("data:") ||
    !/\.svg(\?|$)/i.test(url) ||
    !isAllowedAssetUrl(url)
  ) {
    return null;
  }
  try {
    const { bytes } = await fetchAsset(url);
    const svg = sanitizeSvg(bytes.toString("utf8"));
    const drawn = svg ? measureDrawing(svg) : null;
    if (!svg || !drawn) return null;
    return {
      kind: "vector",
      url,
      colours: named(svgColours(svg, 4)),
      drawnWidthPx: drawn.width,
      ratio: drawn.width / drawn.height,
    };
  } catch {
    return null;
  }
}
