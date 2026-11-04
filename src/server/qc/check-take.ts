import {
  checkExpectedText,
  judgeTake,
  normalizeText,
  type OcrBox,
  type OcrResult,
  type TakeCheck,
  type TakeLineReading,
  uncheckedTake,
} from "@/domain/qc";
import {
  compareLetterforms,
  type InkComponent,
  inkComponents,
  type Letterform,
  letterform,
  type RgbaImage,
  stackedRun,
} from "@/domain/qc-pixels";
import { decodeImage, relayRow } from "@/server/qc/decode";
import type { OcrEngine, TextReader } from "@/server/qc/ocr";

// A take's check: the reference it edited and the take are read the same way,
// and the take is held only to the wording the reference itself reads. Free and
// local; nothing here is paid.

export interface CheckedImage {
  bytes: Uint8Array;
  mime: string;
}

interface Found {
  how: "read" | "stack" | "ambiguous";
  height: number;
  boxes: OcrBox[];
  // Read one piece at a time: its boxes are single characters.
  glyphs: boolean;
}

export interface Reading {
  engine: string;
  image: RgbaImage;
  found: Map<string, Found>;
}

const mean = (values: number[]) =>
  values.reduce((s, v) => s + v, 0) / values.length;

const fraction = (c: InkComponent, img: RgbaImage): OcrBox => ({
  x: c.x / img.width,
  y: c.y / img.height,
  w: c.w / img.width,
  h: c.h / img.height,
});

// The colour just outside the pieces: what the re-laid row stands on.
function groundAround(img: RgbaImage, run: InkComponent[]): string {
  const x0 = Math.min(...run.map((c) => c.x));
  const y0 = Math.min(...run.map((c) => c.y));
  const x1 = Math.max(...run.map((c) => c.x + c.w));
  const y1 = Math.max(...run.map((c) => c.y + c.h));
  const pad = Math.round(mean(run.map((c) => c.h)) * 0.3);
  const left = Math.max(0, x0 - pad);
  const right = Math.min(img.width - 1, x1 + pad);
  const top = Math.max(0, y0 - pad);
  const bottom = Math.min(img.height - 1, y1 + pad);
  const sum = [0, 0, 0];
  let n = 0;
  const add = (x: number, y: number) => {
    const i = 4 * (y * img.width + x);
    sum[0] += img.pixels[i];
    sum[1] += img.pixels[i + 1];
    sum[2] += img.pixels[i + 2];
    n++;
  };
  for (let x = left; x <= right; x++) {
    add(x, top);
    add(x, bottom);
  }
  for (let y = top; y <= bottom; y++) {
    add(left, y);
    add(right, y);
  }
  return `#${sum
    .map((v) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Where each wording line reads in an image: as a line, else (Apple Vision
// drops lone characters) one piece at a time, found by its ink and re-laid
// in a row. Null for an image Kiln cannot open.
export async function readWording(
  image: CheckedImage,
  lines: string[],
  inks: string[],
  read: TextReader,
): Promise<Reading | null> {
  const decoded = decodeImage(image.bytes, image.mime);
  if (!decoded) return null;
  const ocr = await read(image.bytes);
  const text = checkExpectedText({ pieces: [lines] }, ocr, {
    minTextHeight: 0,
    checkOrder: false,
  });
  const found = new Map<string, Found>();
  for (const f of text.lines) {
    if (!f.found || !f.bbox) continue;
    found.set(f.expected, {
      how: f.strict ? "read" : "ambiguous",
      height: f.height ?? f.bbox.h,
      boxes: [f.bbox],
      glyphs: false,
    });
  }
  // What may stand as a stack: a missing line of a few characters drawn one
  // above the other, or every one-character line together when one of them
  // is missing (a 2, a 0 and a 5, each its own piece).
  const chars = (line: string) => line.replaceAll(" ", "");
  const singles = text.lines.filter((f) => chars(f.expected).length === 1);
  const stacks = [
    ...text.lines
      .filter((f) => !f.found && chars(f.expected).length >= 2)
      .map((f) => [f.expected]),
    ...(singles.length >= 2 && singles.some((f) => !f.found)
      ? [singles.map((f) => f.expected)]
      : []),
  ];
  if (stacks.length === 0) return { engine: ocr.engine, image: decoded, found };
  const small = decodeImage(image.bytes, image.mime, 512);
  if (!small) return { engine: ocr.engine, image: decoded, found };
  const components = inks.map((ink) => inkComponents(small, ink));
  for (const group of stacks) {
    const word = group.map(chars).join("");
    for (const parts of components) {
      const run = stackedRun(parts, word.length, small.height);
      if (!run) continue;
      const boxes = run.map((c) => fraction(c, small));
      const row = relayRow(
        image.bytes,
        image.mime,
        boxes,
        groundAround(small, run),
      );
      if (!row || !readsAs(await read(row), word)) continue;
      if (group.length === 1) {
        found.set(group[0], {
          how: "stack",
          height: mean(boxes.map((b) => b.h)),
          boxes,
          glyphs: true,
        });
      } else {
        group.forEach((line, i) => {
          found.set(line, {
            how: "stack",
            height: boxes[i].h,
            boxes: [boxes[i]],
            glyphs: true,
          });
        });
      }
      break;
    }
  }
  return { engine: ocr.engine, image: decoded, found };
}

// A re-laid row reads as the word, its pieces' spacing aside.
function readsAs(ocr: OcrResult, word: string): boolean {
  const all = ocr.lines.map((l) => normalizeText(l.text)).join("");
  return all.replaceAll(" ", "").includes(word);
}

// The letterforms inside where a line was read (each piece's, averaged, for
// a stack), each box padded so its ground is measured too.
function letterformOf(img: RgbaImage, found: Found): Letterform | null {
  const parts = found.boxes.flatMap((b) => {
    const pad = 0.12 * b.h * img.height;
    const measured = letterform(img, {
      x: b.x * img.width - pad,
      y: b.y * img.height - pad,
      w: b.w * img.width + 2 * pad,
      h: b.h * img.height + 2 * pad,
    });
    return measured ? [measured] : [];
  });
  if (parts.length === 0) return null;
  return {
    stroke: mean(parts.map((p) => p.stroke)),
    width: mean(parts.map((p) => p.width)),
    height: mean(parts.map((p) => p.height)),
  };
}

export async function checkTake(input: {
  take: CheckedImage;
  reference: CheckedImage | null;
  expected: string[];
  inks: string[];
  scale: string | null;
  ocr: OcrEngine;
  checkedAt: string;
  // The reference's reading, when another take of the batch already read it.
  readReference?: (
    read: () => Promise<Reading | null>,
  ) => Promise<Reading | null>;
}): Promise<TakeCheck> {
  const at = input.checkedAt;
  const scale = input.scale ?? undefined;
  const lines = input.expected
    .map((e) => e.trim())
    .filter((e) => normalizeText(e) !== "");
  if (lines.length === 0)
    return judgeTake({ lines: [], engine: "none", scale, checkedAt: at });
  if ("none" in input.ocr) return uncheckedTake(input.ocr.none, at, scale);
  const { read } = input.ocr;
  if (!input.reference)
    return uncheckedTake("its reference could not be fetched", at, scale);
  const reference = input.reference;
  const readRef = () => readWording(reference, lines, input.inks, read);
  const ref = await (input.readReference
    ? input.readReference(readRef)
    : readRef());
  if (!ref)
    return uncheckedTake(
      `Kiln cannot open its reference (${reference.mime})`,
      at,
      scale,
    );
  const take = await readWording(input.take, lines, input.inks, read);
  if (!take)
    return uncheckedTake(
      `Kiln cannot open a ${input.take.mime} image`,
      at,
      scale,
    );
  const readings: TakeLineReading[] = lines.map((line) => {
    const key = normalizeText(line);
    const inRef = ref.found.get(key);
    const inTake = take.found.get(key);
    let letters: TakeLineReading["letters"];
    if (inRef && inTake && inRef.glyphs === inTake.glyphs) {
      const a = letterformOf(take.image, inTake);
      const b = letterformOf(ref.image, inRef);
      if (a && b) letters = compareLetterforms(a, b) ?? undefined;
    }
    return {
      expected: line,
      inReference: inRef !== undefined,
      found: inTake !== undefined,
      ...(inTake ? { how: inTake.how, height: inTake.height } : {}),
      ...(letters ? { letters } : {}),
    };
  });
  return judgeTake({
    lines: readings,
    engine: take.engine,
    scale,
    checkedAt: at,
  });
}
