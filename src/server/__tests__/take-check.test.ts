import { existsSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import type { OcrBox, OcrResult } from "@/domain/qc";
import { inkComponents } from "@/domain/qc-pixels";
import {
  type CheckedImage,
  checkTake,
  readWording,
} from "@/server/qc/check-take";
import { decodeImage, imageSize, relayRow } from "@/server/qc/decode";
import { ocrEngine } from "@/server/qc/ocr";

const FONTS = ["HankenGrotesk-Regular.ttf", "HankenGrotesk-Bold.ttf"].map((f) =>
  join(process.cwd(), "assets", "fonts", f),
);
const AT = "2026-11-02T10:00:00.000Z";
const INK = "#1b1b1b";

function png(body: string, ground = "#e9e4dc", size = 512): CheckedImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${ground}"/>${body}</svg>`;
  const bytes = new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: false },
  })
    .render()
    .asPng();
  return { bytes: new Uint8Array(bytes), mime: "image/png" };
}

const text = (t: string, x: number, y: number, size: number, weight = 400) =>
  `<text x="${x}" y="${y}" font-family="Hanken Grotesk" font-weight="${weight}" font-size="${size}" fill="${INK}">${t}</text>`;

// Where the ink is, as the fraction box an OCR engine would report.
function inkBox(image: CheckedImage): OcrBox {
  const img = decodeImage(image.bytes, image.mime);
  if (!img) throw new Error("not decodable");
  const parts = inkComponents(img, INK).filter((c) => c.area > 20);
  const x = Math.min(...parts.map((c) => c.x));
  const y = Math.min(...parts.map((c) => c.y));
  const r = Math.max(...parts.map((c) => c.x + c.w));
  const b = Math.max(...parts.map((c) => c.y + c.h));
  return {
    x: x / img.width,
    y: y / img.height,
    w: (r - x) / img.width,
    h: (b - y) / img.height,
  };
}

const reading = (lines: { text: string; bbox: OcrBox }[]): OcrResult => ({
  engine: "fake-ocr",
  width: 512,
  height: 512,
  lines: lines.map((l) => ({ ...l, confidence: 1 })),
});

// A fake engine: what it reads in each image it was handed; anything else
// (a re-laid row) reads `rest`.
function fakeOcr(
  readings: Map<Uint8Array, OcrResult>,
  rest: OcrResult = reading([]),
) {
  return {
    read: async (image: Uint8Array) => readings.get(image) ?? rest,
  };
}

describe("decode", () => {
  it("reads a PNG's and a JPEG's size from their headers and opens a PNG", () => {
    const image = png("", "#ffffff", 64);
    expect(imageSize(image.bytes)).toEqual({ width: 64, height: 64 });
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x01, 0x80, 0x02, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 512, height: 384 });
    const decoded = decodeImage(image.bytes, "image/png");
    expect(decoded).toMatchObject({ width: 64, height: 64 });
    expect(decoded?.pixels[0]).toBe(255);
    expect(decodeImage(image.bytes, "image/webp")).toBeNull();
    expect(decodeImage(new Uint8Array([1, 2, 3]), "image/png")).toBeNull();
  });

  it("re-lays pieces side by side on the ground given", () => {
    const stack = png(`${text("2", 200, 150, 110)}${text("0", 200, 300, 110)}`);
    const row = relayRow(
      stack.bytes,
      stack.mime,
      [
        { x: 0.38, y: 0.1, w: 0.14, h: 0.2 },
        { x: 0.38, y: 0.4, w: 0.14, h: 0.2 },
      ],
      "#e9e4dc",
    );
    const size = row ? imageSize(row) : null;
    expect(size?.width).toBeGreaterThan(size?.height ?? 0);
  });
});

describe("checkTake", () => {
  const reference = png(text("205", 70, 330, 200));
  const refRead = reading([{ text: "205", bbox: inkBox(reference) }]);

  it("passes a take that reads the wording in the reference's letters, and says the scale", async () => {
    const take = png(text("205", 150, 300, 110), "#d8cfc0");
    const check = await checkTake({
      take,
      reference,
      expected: ["205"],
      inks: [INK],
      scale: "5 x 3 in, about 1/7 as wide as the door",
      ocr: fakeOcr(
        new Map([
          [reference.bytes, refRead],
          [take.bytes, reading([{ text: "205", bbox: inkBox(take) }])],
        ]),
      ),
      checkedAt: AT,
    });
    expect(check.status).toBe("passed");
    expect(check.scale).toBe("5 x 3 in, about 1/7 as wide as the door");
    expect(check.lines[0].letters?.stroke).toBeGreaterThan(0.85);
    expect(check.lines[0].letters?.stroke).toBeLessThan(1.15);
  });

  it("fails a take drawn in a heavier weight than its reference", async () => {
    const take = png(text("205", 70, 330, 200, 700));
    const check = await checkTake({
      take,
      reference,
      expected: ["205"],
      inks: [INK],
      scale: null,
      ocr: fakeOcr(
        new Map([
          [reference.bytes, refRead],
          [take.bytes, reading([{ text: "205", bbox: inkBox(take) }])],
        ]),
      ),
      checkedAt: AT,
    });
    expect(check.status).toBe("failed");
    expect(check.problems[0]).toMatch(
      /^"205" letters thicker than the reference/,
    );
  });

  it("holds a take only to what its reference reads, and fails a line too small", async () => {
    const take = png(text("205", 240, 260, 6));
    const check = await checkTake({
      take,
      reference,
      expected: ["205", "Suite"],
      inks: [INK],
      scale: null,
      ocr: fakeOcr(
        new Map([
          [reference.bytes, refRead],
          [
            take.bytes,
            reading([
              { text: "205", bbox: { x: 0.47, y: 0.5, w: 0.03, h: 0.01 } },
            ]),
          ],
        ]),
      ),
      checkedAt: AT,
    });
    expect(check.status).toBe("failed");
    expect(check.problems).toEqual([
      '"205" too small: 1.0 % of the height (min 1.5 %)',
    ]);
    expect(check.notes).toContain(
      '"Suite" not checked: the reference does not read it either',
    );
  });

  it("reads one character per piece as a stack when the OCR drops them", async () => {
    const stack = (weight: number) =>
      png(
        `${text("2", 200, 140, 110, weight)}${text("0", 200, 290, 110, weight)}${text("5", 200, 440, 110, weight)}`,
      );
    const ref = stack(400);
    const take = stack(400);
    const check = await checkTake({
      take,
      reference: ref,
      expected: ["2", "0", "5"],
      inks: ["#e9e4dc", INK],
      scale: null,
      // Nothing reads in either image; any re-laid row reads "2 0 5".
      ocr: fakeOcr(
        new Map([
          [ref.bytes, reading([])],
          [take.bytes, reading([])],
        ]),
        reading([{ text: "2 0 5", bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 } }]),
      ),
      checkedAt: AT,
    });
    expect(check.status).toBe("passed");
    expect(check.lines.map((l) => l.how)).toEqual(["stack", "stack", "stack"]);
    expect(check.lines.every((l) => l.letters)).toBe(true);
    expect(check.notes).toEqual([
      '"2", "0" and "5" read one piece at a time, as a stack',
    ]);
  });

  it("is unchecked, with its reason and the scale, when nothing can be read", async () => {
    const take = png(text("205", 70, 330, 200));
    const base = {
      take,
      reference,
      expected: ["205"],
      inks: [INK],
      scale: "5 x 3 in",
      checkedAt: AT,
    };
    expect(
      await checkTake({
        ...base,
        ocr: { none: "no OCR engine on this machine" },
      }),
    ).toMatchObject({
      status: "unchecked",
      unchecked: "no OCR engine on this machine",
      scale: "5 x 3 in",
    });
    const ocr = fakeOcr(new Map([[reference.bytes, refRead]]));
    expect(await checkTake({ ...base, expected: [" "], ocr })).toMatchObject({
      status: "unchecked",
      unchecked: "no wording to read",
    });
    expect(
      await checkTake({ ...base, take: { ...take, mime: "image/webp" }, ocr }),
    ).toMatchObject({ unchecked: "Kiln cannot open a image/webp image" });
    expect(await checkTake({ ...base, reference: null, ocr })).toMatchObject({
      unchecked: "its reference could not be fetched",
    });
    expect(await checkTake({ ...base, ocr: fakeOcr(new Map()) })).toMatchObject(
      {
        status: "unchecked",
        unchecked: "the reference shows no wording it can read",
      },
    );
  });
});

// The real engine on this machine: Apple Vision drops lone characters, and
// reads them once they are re-laid in a row.
const VISION = join(process.cwd(), "scripts", "ocr", ".bin", "vision-ocr");
describe.skipIf(process.platform !== "darwin" || !existsSync(VISION))(
  "Apple Vision",
  () => {
    it("reads a stack of single characters through the re-laid row", async () => {
      const engine = await ocrEngine();
      if (!("read" in engine)) throw new Error(engine.none);
      const stack = png(
        `${text("2", 200, 140, 110)}${text("0", 200, 290, 110)}${text("5", 200, 440, 110)}`,
      );
      const found = await readWording(
        stack,
        ["2", "0", "5"],
        [INK],
        engine.read,
      );
      expect([...(found?.found.values() ?? [])].map((f) => f.how)).toEqual([
        "stack",
        "stack",
        "stack",
      ]);
    });
  },
);
