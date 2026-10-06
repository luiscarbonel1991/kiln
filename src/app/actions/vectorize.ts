"use server";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  OptimizePreset,
  optimize,
  Preset,
  vectorize,
} from "@neplex/vectorizer";
import { z } from "zod";
import { fetchAsset, storeAsset } from "@/providers/asset-bytes";

const execFileP = promisify(execFile);

const VectorizeInput = z.object({
  imageUrl: z.string().url(),
  // "outline" (vtracer): traces region boundaries — solid shapes. "centerline"
  // (autotrace): traces stroke midlines — one path per drawn line, the right
  // choice for line art drawn as strokes.
  mode: z.enum(["outline", "centerline"]).default("outline"),
});

// Centerline tracing needs the autotrace binary (no good in-process JS option) +
// ImageMagick to flatten the raster to a clean B&W bitmap first. Both are SYSTEM
// dependencies (Homebrew/apt: `autotrace`, `imagemagick`); the deploy image must
// include them. Temp files are scoped to a per-call dir and always cleaned up.
async function centerlineSvg(bytes: Buffer): Promise<string> {
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

// Server Function: trace a raster (a generated line-art image) into a REAL SVG.
// Two modes (see VectorizeInput); the bundled OXVG optimizer shrinks the result.
// Stored as image/svg+xml. Only meaningful for high-contrast line art — tracing a
// photo yields a bloated SVG, so the UI only exposes this for line-art cards.
export async function vectorizeCardAction(
  input: unknown,
): Promise<{ url: string }> {
  const { imageUrl, mode } = VectorizeInput.parse(input);
  const { bytes } = await fetchAsset(imageUrl);
  const traced =
    mode === "centerline"
      ? await centerlineSvg(bytes)
      : await vectorize(bytes, Preset.Bw);
  // OXVG handles vtracer output cleanly; autotrace's SVG can have quirks it rejects,
  // so fall back to the raw (already-compact) trace if optimization throws.
  let svg = traced;
  try {
    svg = await optimize(traced, {
      preset: OptimizePreset.Safe,
      multipass: true,
    });
  } catch {
    svg = traced;
  }
  return {
    url: await storeAsset(Buffer.from(svg, "utf8"), "image/svg+xml", "vectors"),
  };
}
