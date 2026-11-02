import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { OcrResult } from "@/domain/qc";

const execFileP = promisify(execFile);

// Local OCR for the take check: Apple Vision on macOS, through the same Swift
// helper the brief runner uses (scripts/ocr/vision-ocr.swift), compiled on
// first use into scripts/ocr/.bin/ (gitignored). No network, no cost, about
// 0.3 s an image. Elsewhere there is no engine, and the check says so.
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

let engine: Promise<OcrEngine> | undefined;

// The OCR this machine offers, settled once per process.
export function ocrEngine(): Promise<OcrEngine> {
  if (process.platform !== "darwin") {
    return Promise.resolve({ none: "no OCR engine on this machine" });
  }
  engine ??= compile().then((failed) =>
    failed ? { none: failed } : { read: readWithVision },
  );
  return engine;
}
