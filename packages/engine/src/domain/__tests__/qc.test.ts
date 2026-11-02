import { describe, expect, it } from "vitest";
import {
  checkExpectedText,
  judgeTake,
  lenientKey,
  normalizeText,
  type OcrLine,
  type OcrResult,
  readTakeCheck,
  suggestedReason,
  takeCheckLabel,
  uncheckedTake,
} from "@/domain/qc";
import { compareLetterforms } from "@/domain/qc-pixels";

// Fixtures are real Apple Vision readings of kiln heroes (2026-09-18), trimmed.
const line = (
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<OcrLine> = {},
): OcrLine => ({ text, confidence: 1, bbox: { x, y, w, h }, ...extra });
const ocr = (lines: OcrLine[]): OcrResult => ({
  engine: "apple-vision",
  width: 1024,
  height: 1024,
  lines,
});

const unit204 = ocr([
  line("UNIT", 0.43, 0.33, 0.055, 0.0178),
  line("204", 0.344, 0.369, 0.2285, 0.0977),
]);
const discs = ocr([
  line("01", 0.064, 0.467, 0.068, 0.0508),
  line("02", 0.266, 0.467, 0.08, 0.0508),
  line("03", 0.469, 0.467, 0.082, 0.0508),
  line("04", 0.674, 0.465, 0.082, 0.0527),
  line("05", 0.877, 0.465, 0.082, 0.0547),
]);
const fiveDiscs = {
  pieces: [["01"], ["02"], ["03"], ["04"], ["05"]],
  layout: "row" as const,
};

describe("normalizeText / lenientKey", () => {
  it("upper-cases, strips arrows, punctuation and diacritics, keeps & and /", () => {
    expect(normalizeText("Treatment Rooms →")).toBe("TREATMENT ROOMS");
    expect(normalizeText("  lockers  &  showers. ")).toBe("LOCKERS & SHOWERS");
    expect(normalizeText("Señoras / Damas")).toBe("SENORAS / DAMAS");
  });
  it("maps the classic OCR confusions onto one key", () => {
    expect(lenientKey("2O4")).toBe(lenientKey("204"));
    expect(lenientKey("UNlT")).toBe(lenientKey("UNIT"));
    expect(lenientKey("5TAFF")).toBe(lenientKey("STAFF"));
  });
});

describe("checkExpectedText", () => {
  it("passes a single piece whose lines were read verbatim", () => {
    const r = checkExpectedText({ pieces: [["UNIT", "204"]] }, unit204);
    expect(r.pass).toBe(true);
    expect(r.lines.map((l) => [l.expected, l.found, l.strict])).toEqual([
      ["UNIT", true, true],
      ["204", true, true],
    ]);
    expect(r.extraText).toEqual([]);
    expect(r.orderOk).toBeNull();
  });

  it("fails on a wrong expectation and names the missing line", () => {
    const r = checkExpectedText({ pieces: [["UNIT", "205"]] }, unit204);
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(["205"]);
    expect(r.problems).toEqual(['missing "205" (piece 1)']);
    // the unmatched "204" is reported as extra text, not fatal by default
    expect(r.extraText).toEqual(["204"]);
    expect(
      checkExpectedText({ pieces: [["UNIT", "205"]] }, unit204, {
        failOnExtraText: true,
      }).problems,
    ).toContain("extra text: 204");
  });

  it("passes a row of five discs read left to right", () => {
    const r = checkExpectedText(fiveDiscs, discs);
    expect(r.pass).toBe(true);
    expect(r.orderOk).toBe(true);
    expect(r.lines.every((l) => l.strict)).toBe(true);
  });

  it("fails the row when the pieces are out of order", () => {
    const swapped = ocr([
      ...discs.lines.slice(0, 3),
      line("05", 0.674, 0.465, 0.082, 0.0527),
      line("04", 0.877, 0.465, 0.082, 0.0547),
    ]);
    const r = checkExpectedText(fiveDiscs, swapped);
    expect(r.orderOk).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.problems).toEqual(["pieces out of order (left→right)"]);
  });

  it("fails the rejected hero where only one disc was legible", () => {
    const r = checkExpectedText(
      fiveDiscs,
      ocr([line("03", 0.482, 0.447, 0.053, 0.0488)]),
    );
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(["01", "02", "04", "05"]);
    expect(r.orderOk).toBeNull();
  });

  it("tolerates arrow glyphs read as junk around the wording (stack)", () => {
    const wayfinding = ocr([
      line("TREATMENT ROOMS →", 0.26, 0.387, 0.449, 0.039),
      line("F LOCKERS & SHOWERS", 0.285, 0.611, 0.441, 0.045),
    ]);
    const r = checkExpectedText(
      {
        pieces: [["TREATMENT ROOMS"], ["LOCKERS & SHOWERS"]],
        layout: "stack",
      },
      wayfinding,
    );
    expect(r.pass).toBe(true);
    expect(r.orderOk).toBe(true);
    // the one-letter "F" the left arrow became is not reported as extra text
    expect(r.extraText).toEqual([]);
  });

  it("finds a line the OCR split across two lines", () => {
    const split = ocr([
      line("TREATMENT", 0.26, 0.38, 0.25, 0.04),
      line("ROOMS", 0.52, 0.38, 0.15, 0.04),
    ]);
    const r = checkExpectedText({ pieces: [["TREATMENT ROOMS"]] }, split);
    expect(r.pass).toBe(true);
    expect(r.lines[0].strict).toBe(true);
    expect(r.lines[0].matchedLine).toBe("TREATMENT | ROOMS");
  });

  it("accepts a lenient reading but flags it as ambiguous", () => {
    const r = checkExpectedText(
      { pieces: [["UNIT", "204"]] },
      ocr([
        line("UNIT", 0.43, 0.33, 0.055, 0.02),
        line("2O4", 0.344, 0.369, 0.2285, 0.0977),
      ]),
    );
    expect(r.pass).toBe(true);
    expect(r.ambiguous).toEqual(["204"]);
    expect(r.lines[1].strict).toBe(false);
  });

  it("accepts an alternative OCR candidate, flagged as ambiguous", () => {
    const r = checkExpectedText(
      { pieces: [["STAFF ONLY"]] },
      ocr([
        line("STAFE ONLY", 0.3, 0.4, 0.4, 0.05, {
          candidates: ["STAFE ONLY", "STAFF ONLY"],
        }),
      ]),
    );
    expect(r.pass).toBe(true);
    expect(r.ambiguous).toEqual(["STAFF ONLY"]);
  });

  it("fails a line that was read but is too small to be legible", () => {
    const r = checkExpectedText(
      { pieces: [["UNIT", "204"]] },
      ocr([
        line("UNIT", 0.43, 0.33, 0.03, 0.01),
        line("204", 0.344, 0.369, 0.2285, 0.0977),
      ]),
    );
    expect(r.pass).toBe(false);
    expect(r.tooSmall).toEqual(["UNIT"]);
    expect(r.problems[0]).toMatch(/"UNIT" too small: 1\.0 %/);
    expect(
      checkExpectedText({ pieces: [["UNIT", "204"]] }, r && unit204, {
        minTextHeight: 0.01,
      }).pass,
    ).toBe(true);
  });

  it("ignores low-confidence lines", () => {
    const r = checkExpectedText(
      { pieces: [["204"]] },
      ocr([line("204", 0.3, 0.4, 0.2, 0.1, { confidence: 0.1 })]),
    );
    expect(r.missing).toEqual(["204"]);
  });

  it("consumes a match so identical wording on two pieces needs two readings", () => {
    const one = ocr([line("STAFF ONLY", 0.3, 0.4, 0.4, 0.05)]);
    const r = checkExpectedText(
      { pieces: [["STAFF ONLY"], ["STAFF ONLY"]], layout: "row" },
      one,
    );
    expect(r.missing).toEqual(["STAFF ONLY"]);
    expect(r.lines.map((l) => l.found)).toEqual([true, false]);
  });

  it("does not match a number inside a longer number", () => {
    const r = checkExpectedText(
      { pieces: [["204"]] },
      ocr([line("1204", 0.3, 0.4, 0.2, 0.1)]),
    );
    expect(r.missing).toEqual(["204"]);
  });
});

describe("judgeTake", () => {
  const at = "2026-11-02T10:00:00.000Z";
  const plate = { stroke: 0.08, width: 2.3, height: 340 };
  const same = compareLetterforms(
    { stroke: 0.085, width: 2.2, height: 140 },
    plate,
  );

  it("passes a take that reads every line the reference reads, in the same letters", () => {
    const check = judgeTake({
      engine: "apple-vision",
      checkedAt: at,
      scale: "2.65 x 2.65 in, about 1/5 as wide as the locker door",
      lines: [
        {
          expected: "205",
          inReference: true,
          found: true,
          how: "read",
          height: 0.15,
          letters: same,
        },
        { expected: "Suite", inReference: false, found: false },
      ],
    });
    expect(check.status).toBe("passed");
    expect(check.lines).toHaveLength(1);
    expect(check.lines[0].letters?.stroke).toBeCloseTo(1.06, 2);
    expect(check.notes).toEqual([
      '"Suite" not checked: the reference does not read it either',
    ]);
    expect(takeCheckLabel(check)).toBe("checked · text 1/1 · letters match");
    expect(suggestedReason(check)).toBeNull();
    expect(readTakeCheck(JSON.parse(JSON.stringify(check)))).toEqual(check);
  });

  it("fails a missing line, a line too small to read, and a heavier weight", () => {
    const bold = compareLetterforms(
      { stroke: 0.15, width: 2.3, height: 150 },
      plate,
    );
    const check = judgeTake({
      engine: "apple-vision",
      checkedAt: at,
      lines: [
        {
          expected: "205",
          inReference: true,
          found: true,
          how: "stack",
          height: 0.2,
          letters: bold,
        },
        {
          expected: "Suite",
          inReference: true,
          found: true,
          how: "read",
          height: 0.01,
        },
        { expected: "Floor 2", inReference: true, found: false },
      ],
    });
    expect(check.status).toBe("failed");
    expect(check.problems).toEqual([
      '"205" letters thicker than the reference: stroke 0.15 vs 0.08 of their height',
      '"Suite" too small: 1.0 % of the height (min 1.5 %)',
      'missing "Floor 2"',
    ]);
    expect(check.notes).toEqual(['"205" read one piece at a time, as a stack']);
    expect(takeCheckLabel(check)).toBe(
      'check failed · "205" letters thicker than the reference: stroke 0.15 vs 0.08 of their height',
    );
    expect(suggestedReason(check)).toBe("small");
  });

  it("notes a narrower line without failing it: an angled camera narrows letters too", () => {
    const narrow = compareLetterforms(
      { stroke: 0.08, width: 1.7, height: 140 },
      plate,
    );
    const check = judgeTake({
      engine: "apple-vision",
      checkedAt: at,
      lines: [
        {
          expected: "205",
          inReference: true,
          found: true,
          height: 0.1,
          letters: narrow,
        },
      ],
    });
    expect(check.status).toBe("passed");
    expect(check.notes[0]).toMatch(
      /narrower than the reference .*angled camera/,
    );
  });

  it("is unchecked when the reference reads none of the wording, or there is none", () => {
    const none = judgeTake({
      engine: "apple-vision",
      checkedAt: at,
      lines: [],
    });
    expect(none).toMatchObject({
      status: "unchecked",
      unchecked: "no wording to read",
    });
    const unread = judgeTake({
      engine: "apple-vision",
      checkedAt: at,
      lines: [{ expected: "Quiet please", inReference: false, found: false }],
    });
    expect(unread.unchecked).toBe("the reference shows no wording it can read");
    const elsewhere = uncheckedTake(
      "no OCR engine on this machine",
      at,
      "5 x 3 in",
    );
    expect(takeCheckLabel(elsewhere)).toBe(
      "unchecked · no OCR engine on this machine",
    );
    expect(elsewhere.scale).toBe("5 x 3 in");
    expect(readTakeCheck({ status: "maybe" })).toBeNull();
  });
});
