import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { OcrResult } from "@/domain/qc";
import { env } from "@/lib/env";
import { decodeImage } from "@/server/qc/decode";
import {
  contrasted,
  halved,
  mergeReadings,
  pgm,
  tesseractReading,
} from "@/server/qc/tesseract";

const execFileP = promisify(execFile);

// Local OCR for the take check, free and offline: Apple Vision on macOS, a
// Swift helper (scripts/ocr/vision-ocr.swift) compiled on first use into
// scripts/ocr/.bin/ (gitignored), about 0.3 s an image; Tesseract elsewhere
// (the Docker image installs it). KILN_OCR picks one; without an engine the
// check says so.
const SRC = join(process.cwd(), "scripts", "ocr", "vision-ocr.swift");
const BIN = join(process.cwd(), "scripts", "ocr", ".bin", "vision-ocr");

export type TextReader = (image: Uint8Array) => Promise<OcrResult>;
export type OcrEngine = { read: TextReader } | { none: string };

const Reading = z.object({
  engine: z.string(),
  width: z.number(),
  height: z.number(),
  lines: z.array(
    z.object({
      text: z.string(),
      confidence: z.number(),
      candidates: z.array(z.string()).optional(),
      bbox: z.object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    }),
  ),
});

async function mtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

async function compile(): Promise<string | null> {
  const [src, bin] = await Promise.all([mtime(SRC), mtime(BIN)]);
  if (bin !== null && (src === null || bin >= src)) return null;
  if (src === null) return "the Apple Vision helper is missing";
  await mkdir(dirname(BIN), { recursive: true });
  try {
    await execFileP("swiftc", ["-O", "-o", BIN, SRC], { timeout: 120_000 });
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "Apple Vision needs the Xcode command line tools (xcode-select --install)"
      : "the Apple Vision helper did not compile";
  }
}

async function readWithVision(image: Uint8Array): Promise<OcrResult> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-ocr-"));
  try {
    const path = join(dir, "take");
    await writeFile(path, image);
    const { stdout } = await execFileP(BIN, [path, "--min-height", "0.01"], {
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return Reading.parse(JSON.parse(stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tesseractTsv(path: string): Promise<string> {
  // Sparse text: a scene's wording sits anywhere in the frame. One thread
  // each, as the passes run side by side.
  const { stdout } = await execFileP(
    "tesseract",
    [path, "stdout", "--psm", "11", "tsv"],
    {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    },
  );
  return stdout;
}

// The take as it is, then in grey with its contrast raised, then that at
// half size (src/server/qc/tesseract.ts), every line kept.
async function readWithTesseract(image: Uint8Array): Promise<OcrResult> {
  const dir = await mkdtemp(join(tmpdir(), "kiln-ocr-"));
  try {
    const paths = [join(dir, "take")];
    await writeFile(paths[0], image);
    const mime = image[0] === 0x89 ? "image/png" : "image/jpeg";
    const pixels = decodeImage(image, mime);
    if (pixels) {
      const grey = contrasted(pixels);
      paths.push(join(dir, "grey.pgm"), join(dir, "half.pgm"));
      await writeFile(paths[1], pgm(grey));
      await writeFile(paths[2], pgm(halved(grey)));
    }
    const tsv = await Promise.all(paths.map(tesseractTsv));
    return mergeReadings(tsv.map(tesseractReading));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tesseract(): Promise<OcrEngine> {
  try {
    await execFileP("tesseract", ["--version"], { timeout: 10_000 });
    return { read: readWithTesseract };
  } catch {
    return {
      none: "Tesseract is not installed (apt-get install tesseract-ocr · brew install tesseract)",
    };
  }
}

async function vision(): Promise<OcrEngine> {
  if (process.platform !== "darwin") {
    return { none: "Apple Vision runs on macOS only" };
  }
  const failed = await compile();
  return failed ? { none: failed } : { read: readWithVision };
}

let engine: Promise<OcrEngine> | undefined;

// The OCR this machine offers, settled once per process: KILN_OCR's, else
// Apple Vision on macOS and Tesseract elsewhere.
export function ocrEngine(): Promise<OcrEngine> {
  const pick =
    env.KILN_OCR ?? (process.platform === "darwin" ? "vision" : "tesseract");
  engine ??=
    pick === "none"
      ? Promise.resolve({ none: "the take check is off (KILN_OCR=none)" })
      : pick === "vision"
        ? vision()
        : tesseract();
  return engine;
}
