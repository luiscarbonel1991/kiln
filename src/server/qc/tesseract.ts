import type { OcrBox, OcrLine, OcrResult } from "@/domain/qc";
import type { RgbaImage } from "@/domain/qc-pixels";

interface Word {
  text: string;
  conf: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Tesseract's TSV (a row per page, block, paragraph, line and word) as an
// OcrResult: each line its words joined, its box normalized to the page with
// the origin top-left, its confidence the mean of its words' (0..1).
export function tesseractReading(tsv: string): OcrResult {
  let width = 0;
  let height = 0;
  const lines = new Map<string, Word[]>();
  for (const row of tsv.split("\n").slice(1)) {
    const cells = row.split("\t");
    if (cells.length < 12) continue;
    const [level, , block, par, line, , left, top, w, h, conf] = cells;
    const text = cells.slice(11).join(" ").trim();
    if (level === "1") {
      width = Number(w);
      height = Number(h);
      continue;
    }
    if (level !== "5" || text === "" || Number(conf) < 0) continue;
    const key = `${block}.${par}.${line}`;
    const words = lines.get(key) ?? [];
    words.push({
      text,
      conf: Number(conf) / 100,
      left: Number(left),
      top: Number(top),
      right: Number(left) + Number(w),
      bottom: Number(top) + Number(h),
    });
    lines.set(key, words);
  }
  const read: OcrLine[] = [];
  if (width === 0 || height === 0) {
    return { engine: "tesseract", width, height, lines: read };
  }
  for (const words of lines.values()) {
    const x0 = Math.min(...words.map((w) => w.left));
    const y0 = Math.min(...words.map((w) => w.top));
    const x1 = Math.max(...words.map((w) => w.right));
    const y1 = Math.max(...words.map((w) => w.bottom));
    read.push({
      text: words.map((w) => w.text).join(" "),
      confidence: words.reduce((s, w) => s + w.conf, 0) / words.length,
      bbox: {
        x: x0 / width,
        y: y0 / height,
        w: (x1 - x0) / width,
        h: (y1 - y0) / height,
      },
    });
  }
  return { engine: "tesseract", width, height, lines: read };
}

export interface GreyImage {
  width: number;
  height: number;
  grey: Uint8Array;
}

// Tesseract misses lettering close to its ground in tone (engraved wood),
// which Apple Vision reads: the take is also read in grey with its contrast
// raised (a sigmoid around the mid-tone, then stretched from its 2nd to its
// 99th percentile, as ImageMagick's -sigmoidal-contrast 10x50% -normalize).
export function contrasted(img: RgbaImage): GreyImage {
  const n = img.width * img.height;
  const grey = new Uint8Array(n);
  const s = (u: number) => 1 / (1 + Math.exp(10 * (0.5 - u)));
  const [s0, s1] = [s(0), s(1)];
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    const a = img.pixels[4 * i + 3] / 255;
    const tone =
      (0.299 * img.pixels[4 * i] +
        0.587 * img.pixels[4 * i + 1] +
        0.114 * img.pixels[4 * i + 2]) *
        a +
      255 * (1 - a);
    const v = Math.round(((s(tone / 255) - s0) / (s1 - s0)) * 255);
    grey[i] = v;
    counts[v]++;
  }
  const at = (share: number) => {
    let sum = 0;
    for (let v = 0; v < 256; v++) {
      sum += counts[v];
      if (sum >= share * n) return v;
    }
    return 255;
  };
  const [lo, hi] = [at(0.02), at(0.99)];
  if (hi > lo) {
    for (let i = 0; i < n; i++) {
      const v = ((grey[i] - lo) / (hi - lo)) * 255;
      grey[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { width: img.width, height: img.height, grey };
}

// Half the size, each pixel the mean of four: very large glyphs come within
// the sizes Tesseract reads.
export function halved(img: GreyImage): GreyImage {
  const width = Math.max(1, Math.floor(img.width / 2));
  const height = Math.max(1, Math.floor(img.height / 2));
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 2 * y * img.width + 2 * x;
      const right = 2 * x + 1 < img.width ? 1 : 0;
      const below = 2 * y + 1 < img.height ? img.width : 0;
      grey[y * width + x] = Math.round(
        (img.grey[i] +
          img.grey[i + right] +
          img.grey[i + below] +
          img.grey[i + below + right]) /
          4,
      );
    }
  }
  return { width, height, grey };
}

// A grey image as binary PGM, a format Tesseract opens without a codec.
export function pgm(img: GreyImage): Uint8Array {
  const header = Buffer.from(`P5\n${img.width} ${img.height}\n255\n`);
  return Buffer.concat([header, img.grey]);
}

const overlap = (a: OcrBox, b: OcrBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const same = (a: string, b: string) =>
  a.toLowerCase().replace(/\s+/g, " ").trim() ===
  b.toLowerCase().replace(/\s+/g, " ").trim();

// Every line the passes read, the first reading's size; a line read again in
// the same place is kept once.
export function mergeReadings(readings: OcrResult[]): OcrResult {
  const lines: OcrLine[] = [];
  for (const reading of readings) {
    for (const line of reading.lines) {
      const known = lines.some(
        (l) => same(l.text, line.text) && overlap(l.bbox, line.bbox),
      );
      if (!known) lines.push(line);
    }
  }
  const [first] = readings;
  return {
    engine: "tesseract",
    width: first?.width ?? 0,
    height: first?.height ?? 0,
    lines,
  };
}
