import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fetchAsset } from "@/providers/asset-bytes";

const execFileP = promisify(execFile);

// A video's start frame: the approved scene, cover-cropped to the size the clip
// renders at, so the model never letterboxes or stretches it. ImageMagick is
// already a system dependency (vectorize, Deliver); temp files are scoped and
// cleaned.

export function isFetchable(ref: string): boolean {
  return /^(https?:|data:)/.test(ref) && !ref.includes("stub.local");
}

export async function frameSizedTo(
  bytes: Buffer | Uint8Array,
  w: number,
  h: number,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-frame-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.png");
    await writeFile(src, bytes);
    await execFileP("magick", [
      src,
      "-resize",
      `${w}x${h}^`,
      "-gravity",
      "center",
      "-extent",
      `${w}x${h}`,
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PIXEL = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

// A stand-in clip for mock runs and key-free tests: the start frame itself (an
// image, not a video) when it can be read, else a 1x1 PNG, so the board's flow
// can be exercised without a paid call.
export async function startFrameStandIn(
  startFrame: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (isFetchable(startFrame)) {
    try {
      const frame = await fetchAsset(startFrame);
      return { bytes: frame.bytes, mime: frame.mime };
    } catch {
      // fall through to the pixel
    }
  }
  return { bytes: PIXEL, mime: "image/png" };
}
