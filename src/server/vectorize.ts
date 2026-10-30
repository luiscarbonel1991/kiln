import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ColorMode,
  type Config,
  Hierarchical,
  OptimizePreset,
  optimize,
  PathSimplifyMode,
  Preset,
  vectorize,
} from "@neplex/vectorizer";
import { z } from "zod";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";

const execFileP = promisify(execFile);

// "outline" (vtracer): traces region boundaries — solid shapes. "centerline"
// (autotrace): traces stroke midlines — one path per drawn line, the right
// choice for line art drawn as strokes.
export const VectorMode = z.enum(["outline", "centerline"]);
export type VectorMode = z.infer<typeof VectorMode>;

// How much of the drawing the trace keeps: "fine" keeps small marks and
// sharp turns, "balanced" is the studio's trace, "clean" drops specks and
// smooths the curves (the clean-up), at the cost of small detail.
export const VectorDetail = z.enum(["fine", "balanced", "clean"]);
export type VectorDetail = z.infer<typeof VectorDetail>;

const BW: Config = {
  colorMode: ColorMode.Binary,
  hierarchical: Hierarchical.Stacked,
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  mode: PathSimplifyMode.Spline,
  cornerThreshold: 60,
  lengthThreshold: 4,
  maxIterations: 10,
  spliceThreshold: 45,
};

const OUTLINE: Record<VectorDetail, Config | Preset> = {
  fine: { ...BW, filterSpeckle: 2, lengthThreshold: 3.5, pathPrecision: 3 },
  balanced: Preset.Bw,
  clean: {
    ...BW,
    filterSpeckle: 12,
    cornerThreshold: 90,
    lengthThreshold: 6,
    spliceThreshold: 60,
    pathPrecision: 2,
  },
};

const CENTERLINE: Record<VectorDetail, string[]> = {
  fine: ["-filter-iterations", "2", "-error-threshold", "1"],
  balanced: [],
  clean: [
    "-despeckle-level",
    "6",
    "-filter-iterations",
    "8",
    "-error-threshold",
    "3",
  ],
};

// Centerline tracing needs the autotrace binary (no good in-process JS option) +
// ImageMagick to flatten the raster to a clean B&W bitmap first. Both are SYSTEM
// dependencies (Homebrew/apt: `autotrace`, `imagemagick`); the deploy image must
// include them. Temp files are scoped to a per-call dir and always cleaned up.
async function centerlineSvg(
  bytes: Buffer,
  detail: VectorDetail,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-vec-"));
  try {
    const src = join(dir, "in");
    const bmp = join(dir, "in.bmp");
    const out = join(dir, "out.svg");
    await writeFile(src, bytes);
    // Flatten to a hard black/white bitmap so autotrace skeletonizes clean strokes.
    await execFileP("magick", [
      src,
      "-colorspace",
      "Gray",
      "-threshold",
      "50%",
      bmp,
    ]);
    await execFileP("autotrace", [
      "-centerline",
      ...CENTERLINE[detail],
      "-background-color",
      "FFFFFF",
      "-output-format",
      "svg",
      "-output-file",
      out,
      bmp,
    ]);
    return await readFile(out, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Why a trace failed, in words the maker can act on.
export function traceProblem(error: unknown, mode: VectorMode): string {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (mode === "centerline" && e?.code === "ENOENT") {
    return "Centerline needs autotrace and ImageMagick on the server. Try Outline.";
  }
  const message = typeof e?.message === "string" ? e.message : String(error);
  return `Could not trace this image: ${message.slice(0, 200)}`;
}

export interface TracedVector {
  url: string;
  // How many outlines or strokes the SVG draws (its paths' subpaths: the
  // optimizer merges path elements), and its size: what a cleaner trace cuts.
  shapes: number;
  bytes: number;
}

const shapesOf = (svg: string) =>
  [...svg.matchAll(/\sd="([^"]*)"/g)].reduce(
    (n, [, d]) => n + (d.match(/[Mm]/g)?.length ?? 0),
    0,
  );

// Trace a raster (a drawing's line art) into a real SVG, shrink it with the
// bundled OXVG optimizer (harder for "clean") and store it as image/svg+xml.
// Only meaningful for high-contrast line art: tracing a photo yields a
// bloated SVG. A failure comes back with its reason, never silently.
export async function traceToVector(
  imageUrl: string,
  mode: VectorMode,
  detail: VectorDetail = "balanced",
): Promise<TracedVector | { error: string }> {
  let traced: string;
  try {
    const { bytes } = await fetchAsset(imageUrl);
    traced =
      mode === "centerline"
        ? await centerlineSvg(bytes, detail)
        : await vectorize(bytes, OUTLINE[detail]);
  } catch (error) {
    return { error: traceProblem(error, mode) };
  }
  // OXVG handles vtracer output cleanly; autotrace's SVG can have quirks it rejects,
  // so fall back to the raw (already-compact) trace if optimization throws.
  let svg = traced;
  try {
    svg = await optimize(traced, {
      preset: detail === "clean" ? OptimizePreset.Default : OptimizePreset.Safe,
      multipass: true,
    });
  } catch {
    svg = traced;
  }
  const buffer = Buffer.from(svg, "utf8");
  return {
    url: await storeAsset(buffer, "image/svg+xml", "vectors"),
    shapes: shapesOf(svg),
    bytes: buffer.length,
  };
}
