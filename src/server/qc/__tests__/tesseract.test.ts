import { describe, expect, it } from "vitest";
import type { OcrLine, OcrResult } from "@/domain/qc";
import {
  contrasted,
  halved,
  mergeReadings,
  pgm,
  tesseractReading,
} from "@/server/qc/tesseract";

// What `tesseract <take> stdout --psm 11 tsv` printed for the Home sample's
// marketplace hero (an earlier sample, no longer shipped), block and line rows kept.
const HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const TSV = [
  HEADER,
  "1\t1\t0\t0\t0\t0\t0\t0\t1080\t1080\t-1\t",
  "2\t1\t1\t0\t0\t0\t272\t429\t596\t115\t-1\t",
  "4\t1\t1\t1\t1\t0\t272\t429\t596\t115\t-1\t",
  "5\t1\t1\t1\t1\t1\t272\t429\t213\t109\t92.420708\tThe",
  "5\t1\t1\t1\t1\t2\t510\t435\t358\t101\t92.427299\tRiveras",
  "2\t1\t2\t0\t0\t0\t482\t644\t196\t68\t-1\t",
  "5\t1\t2\t1\t1\t1\t482\t644\t196\t68\t96.153580\t2026",
  "5\t1\t3\t1\t1\t1\t10\t10\t4\t4\t-1\t ",
].join("\n");

describe("tesseractReading", () => {
  it("joins each line's words, boxes normalized to the page, origin top-left", () => {
    const reading = tesseractReading(TSV);
    expect(reading).toMatchObject({
      engine: "tesseract",
      width: 1080,
      height: 1080,
    });
    expect(reading.lines.map((l) => l.text)).toEqual(["The Riveras", "2026"]);
    const [name, year] = reading.lines;
    expect(name.bbox.x).toBeCloseTo(272 / 1080);
    expect(name.bbox.y).toBeCloseTo(429 / 1080);
    expect(name.bbox.w).toBeCloseTo((868 - 272) / 1080);
    expect(name.bbox.h).toBeCloseTo((536 - 429) / 1080);
    expect(name.confidence).toBeCloseTo(0.924, 2);
    expect(year.confidence).toBeCloseTo(0.9615, 3);
  });

  it("reads nothing from an empty page or a TSV without one", () => {
    expect(tesseractReading(`${HEADER}\n`).lines).toEqual([]);
    expect(tesseractReading("").lines).toEqual([]);
  });
});

const rgba = (tones: number[], alpha = 255) => ({
  width: tones.length,
  height: 1,
  pixels: new Uint8Array(tones.flatMap((t) => [t, t, t, alpha])),
});

describe("the grey pass", () => {
  it("pulls lettering close to its ground in tone apart", () => {
    const tones = [...Array(50).fill(160), ...Array(50).fill(185)];
    const { grey } = contrasted(rgba(tones));
    expect(grey[0]).toBeLessThan(20);
    expect(grey[99]).toBeGreaterThan(235);
  });

  it("lays a transparent image on white", () => {
    const { grey } = contrasted(rgba([0, 0, 0, 0], 0));
    expect([...grey]).toEqual([255, 255, 255, 255]);
  });

  it("halves an image, each pixel the mean of four", () => {
    const half = halved({
      width: 4,
      height: 2,
      grey: new Uint8Array([0, 100, 200, 200, 100, 200, 200, 200]),
    });
    expect(half).toEqual({
      width: 2,
      height: 1,
      grey: new Uint8Array([100, 200]),
    });
  });

  it("writes binary PGM", () => {
    const bytes = pgm({ width: 2, height: 1, grey: new Uint8Array([0, 255]) });
    expect(Buffer.from(bytes).toString("latin1")).toBe(
      "P5\n2 1\n255\n\x00\xff",
    );
  });
});

describe("mergeReadings", () => {
  const line = (text: string, x: number): OcrLine => ({
    text,
    confidence: 0.9,
    bbox: { x, y: 0.4, w: 0.3, h: 0.1 },
  });
  const reading = (width: number, lines: OcrLine[]): OcrResult => ({
    engine: "tesseract",
    width,
    height: width,
    lines,
  });

  it("keeps every line the passes read, a line read again in place once", () => {
    const merged = mergeReadings([
      reading(1024, [line("The Riveras", 0.2)]),
      reading(1024, [line("the  riveras", 0.25), line("2026", 0.6)]),
      reading(512, [line("The Riveras", 0.7)]),
    ]);
    expect(merged.width).toBe(1024);
    expect(merged.lines.map((l) => [l.text, l.bbox.x])).toEqual([
      ["The Riveras", 0.2],
      ["2026", 0.6],
      ["The Riveras", 0.7],
    ]);
  });
});
