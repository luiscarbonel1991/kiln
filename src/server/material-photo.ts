import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { rasterType } from "@/domain/image-type";
import {
  type Gains,
  matchGains,
  type Rgb,
  whiteGains,
} from "@/lib/material-check";
import { colourName } from "@/lib/product-form";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";
import { photoColours } from "@/server/product-files";

// A material photo corrected without a model (src/lib/material-check.ts):
// white balance from a spot the maker taps, or its colour brought to the
// swatch. The photo keeps its format and comes back upright with its metadata
// stripped, so the orientation is baked in.

const execFileP = promisify(execFile);

export type Corrected =
  | { bytes: Uint8Array; mime: string }
  | { refused: string };

// Where the maker tapped, from the top left of the upright photo (0 to 1).
export interface Spot {
  x: number;
  y: number;
}

const NOT_A_PHOTO = {
  refused:
    "A material photo must be a PNG, JPEG or WebP image: a close photo of the material, even light, no text.",
};

const FORMAT: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/png": "png",
};

async function magick(args: string[]): Promise<Buffer> {
  const { stdout } = await execFileP("magick", args, {
    encoding: "buffer",
    maxBuffer: 64 << 20,
  });
  return stdout;
}

async function withFile<T>(
  bytes: Uint8Array,
  run: (src: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-material-"));
  try {
    const src = join(dir, "in");
    await writeFile(src, bytes);
    return await run(src);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The mean colour of a small square around the spot (2% of the shorter side).
async function spotColour(src: string, at: Spot): Promise<Rgb | null> {
  const size = (
    await magick([src, "-auto-orient", "-format", "%w %h", "info:"])
  )
    .toString()
    .trim()
    .split(" ")
    .map(Number);
  const [w, h] = size;
  if (!(w > 0 && h > 0)) return null;
  const side = Math.max(3, Math.round(Math.min(w, h) * 0.02));
  const left = Math.min(Math.max(0, Math.round(at.x * w - side / 2)), w - side);
  const top = Math.min(Math.max(0, Math.round(at.y * h - side / 2)), h - side);
  const mean = await magick([
    src,
    "-auto-orient",
    "-crop",
    `${side}x${side}+${left}+${top}`,
    "+repage",
    "-scale",
    "1x1!",
    "-depth",
    "8",
    "rgb:-",
  ]);
  return mean.length >= 3 ? [mean[0], mean[1], mean[2]] : null;
}

async function applied(
  src: string,
  mime: string,
  gains: Gains,
): Promise<Corrected> {
  if ("refused" in gains) return gains;
  const [r, g, b] = gains.gains.map((v) => v.toFixed(5));
  const format = FORMAT[mime] ?? "png";
  const bytes = await magick([
    src,
    "-auto-orient",
    "-color-matrix",
    `${r} 0 0 0 ${g} 0 0 0 ${b}`,
    "-strip",
    ...(format === "png" ? [] : ["-quality", "92"]),
    `${format}:-`,
  ]);
  return { bytes: new Uint8Array(bytes), mime: `image/${format}` };
}

// White balance: the tapped spot becomes neutral, and the rest of the photo
// moves with it.
export async function balanceWhite(
  bytes: Uint8Array,
  at: Spot,
): Promise<Corrected> {
  const mime = rasterType(bytes);
  if (!mime) return NOT_A_PHOTO;
  return withFile(bytes, async (src) => {
    const spot = await spotColour(src, at);
    if (!spot) return NOT_A_PHOTO;
    return applied(src, mime, whiteGains(spot));
  });
}

// The swatch is the truth: the photo's colour (its main one, as the import
// reads it) is brought to the swatch, the grain kept.
export async function matchSwatch(
  bytes: Uint8Array,
  swatch: string,
): Promise<Corrected> {
  const mime = rasterType(bytes);
  if (!mime) return NOT_A_PHOTO;
  const [photo] = await photoColours(bytes, 1);
  if (!photo) return NOT_A_PHOTO;
  return withFile(bytes, (src) =>
    applied(src, mime, matchGains(photo, swatch)),
  );
}

// A stored sample as the product form checks it: its address and its main
// colour.
export type SampleCheck =
  | { url: string; colour: { name: string; hex: string } | null }
  | { error: string };

async function sampleBytes(url: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array((await fetchAsset(url)).bytes);
  } catch {
    return null;
  }
}

async function checked(url: string, bytes: Uint8Array): Promise<SampleCheck> {
  const [hex] = await photoColours(bytes, 1);
  return { url, colour: hex ? { name: colourName(hex), hex } : null };
}

const UNREAD = { error: "That material photo could not be read." };

export async function readSample(url: string): Promise<SampleCheck> {
  const bytes = await sampleBytes(url);
  return bytes ? checked(url, bytes) : UNREAD;
}

// A stored sample corrected (its light from a tapped spot, or its colour to
// the swatch) and stored again by its bytes: the product changes only when
// the form is saved.
export async function correctSample(
  url: string,
  how: { white: Spot } | { swatch: string },
): Promise<SampleCheck> {
  const bytes = await sampleBytes(url);
  if (!bytes) return UNREAD;
  const result =
    "white" in how
      ? await balanceWhite(bytes, how.white)
      : await matchSwatch(bytes, how.swatch);
  if ("refused" in result) return { error: result.refused };
  const stored = await storeAsset(result.bytes, result.mime, "products", {
    byContent: true,
  });
  return checked(stored, result.bytes);
}
