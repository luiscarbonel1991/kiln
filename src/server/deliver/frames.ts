import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import { createElement } from "react";
import { ExactSlotArt } from "@/components/projects/exact-slot-art";
import type { DestinationProfile } from "@/domain/destination";
import type { ExactView } from "@/domain/exact";
import type { PlateImage } from "@/lib/plate-href";
import { toSvgMarkup } from "@/lib/svg-markup";

const execFileP = promisify(execFile);

// A delivered frame's pixel size: the slot's aspect with its short side at the
// destination's pixel target for that aspect (Etsy: 2000), else the largest
// target the destination names, else 2000.
export function targetSize(
  aspect: string | undefined,
  destination: Pick<DestinationProfile, "formats">,
): { width: number; height: number } {
  const ratio = aspect ?? "1:1";
  const [a, b] = ratio.split(":").map(Number);
  const targets = destination.formats.flatMap((f) =>
    f.minPx ? [f.minPx] : [],
  );
  const minPx =
    destination.formats.find((f) => f.aspect === ratio)?.minPx ??
    (targets.length > 0 ? Math.max(...targets) : 2000);
  if (!a || !b) return { width: minPx, height: minPx };
  return a <= b
    ? { width: minPx, height: Math.round((minPx * b) / a) }
    : { width: Math.round((minPx * a) / b), height: minPx };
}

// The exact frames' fonts, vendored as static TTFs (OFL, assets/fonts): resvg
// reads font files, not the app's next/font. The product's own typography
// comes from the system's fonts.
const FONT_DIR = join(process.cwd(), "assets", "fonts");
const FONT_FILES = [
  "Fraunces-Regular.ttf",
  "Fraunces-Italic.ttf",
  "HankenGrotesk-Regular.ttf",
  "HankenGrotesk-SemiBold.ttf",
  "HankenGrotesk-Bold.ttf",
  "JetBrainsMono-Regular.ttf",
].map((f) => join(FONT_DIR, f));

export const EXPORT_FONTS = {
  "var(--font-fraunces)": "Fraunces",
  "var(--font-hanken)": "Hanken Grotesk",
  "var(--font-jetbrains-mono)": "JetBrains Mono",
};

// The same SVG the board draws, with real font names. A plate must already
// be a data: URL (resvg fetches nothing).
export function exactFrameSvg(
  view: ExactView,
  aspect: string | undefined,
  plate: PlateImage | null,
): string {
  return toSvgMarkup(createElement(ExactSlotArt, { view, aspect, plate }), {
    fonts: EXPORT_FONTS,
  });
}

export const EXPORT_FONT_OPTIONS = {
  fontFiles: FONT_FILES,
  loadSystemFonts: true,
  defaultFontFamily: "Hanken Grotesk",
};

export function renderExactPng(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: EXPORT_FONT_OPTIONS,
  });
  return resvg.render().asPng();
}

// An approved scene at the delivery size: cover-cropped to the slot's aspect
// (gpt-image returns 2:3 for a 4:5 slot), Lanczos to the target, a light
// unsharp, JPEG at quality 92. Local and free; the image is the approved one.
export async function upscaleScene(
  bytes: Uint8Array,
  size: { width: number; height: number },
): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-deliver-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.jpg");
    await writeFile(src, bytes);
    const box = `${size.width}x${size.height}`;
    try {
      await execFileP("magick", [
        src,
        "-filter",
        "Lanczos",
        "-resize",
        `${box}^`,
        "-gravity",
        "center",
        "-extent",
        box,
        "-unsharp",
        "0x0.75+0.6+0.008",
        "-quality",
        "92",
        out,
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "ImageMagick (`magick`) is needed to upscale scenes for delivery: brew install imagemagick.",
        );
      }
      throw error;
    }
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The maker's own photo as a JPEG, as it is (no crop, no resize; quality 92):
// for a WebP, which Etsy does not take.
export async function asJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-deliver-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.jpg");
    await writeFile(src, bytes);
    await execFileP("magick", [src, "-quality", "92", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
