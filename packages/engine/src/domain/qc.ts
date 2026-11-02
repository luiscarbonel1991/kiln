// QC v2 — text fidelity (ROADMAP Phase 10). Pure: takes what the plate promised
// (expectedText per piece, the layout) and what an OCR engine read from the
// generated image, and says whether every promised line is there, legible and in
// order. OCR engines live outside the engine (scripts/ocr.mjs: Apple Vision on
// macOS); they only have to produce an OcrResult. Nothing here touches the network.

import { z } from "zod";
import type { LetterComparison } from "@/domain/qc-pixels";
import type { ReasonKey } from "@/domain/scene-knobs";

// Normalized to the frame (0..1), origin TOP-left.
export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  text: string;
  confidence: number;
  // Alternative readings the engine offered (best first), when it has them.
  candidates?: string[];
  bbox: OcrBox;
}

export interface OcrResult {
  engine: string;
  width: number;
  height: number;
  lines: OcrLine[];
}

// What the plate promised: one string[] of wording lines per piece, in piece order.
export interface ExpectedText {
  pieces: string[][];
  layout?: "single" | "row" | "stack";
}

export interface TextCheckOptions {
  // A matched line must be at least this fraction of the frame height (1.5 % ≈ 15 px
  // on a 1024 px hero, ≈ 4 px at Etsy thumbnail size — the floor of legibility).
  minTextHeight?: number;
  // OCR lines under this confidence are ignored entirely.
  minConfidence?: number;
  // Leftover words the OCR read that no piece promised: reported always, fatal only
  // when this is set (wood grain and arrows produce harmless one-letter noise).
  failOnExtraText?: boolean;
  // Pieces must appear left→right (row) or top→bottom (stack). Default: on when
  // there is more than one piece and the layout is not "single".
  checkOrder?: boolean;
}

export interface TextLineFinding {
  piece: number;
  expected: string;
  found: boolean;
  // true when the letters matched verbatim; false when only a lenient reading
  // (O/0, I/1, S/5…) or an alternative OCR candidate matched.
  strict: boolean;
  matchedLine: string | null;
  height: number | null;
  confidence: number | null;
  tooSmall: boolean;
}

export interface TextCheck {
  pass: boolean;
  engine: string;
  lines: TextLineFinding[];
  missing: string[];
  ambiguous: string[];
  tooSmall: string[];
  extraText: string[];
  orderOk: boolean | null;
  problems: string[];
}

// Upper-case, ASCII letters/digits plus & and /, single spaces. Arrows, punctuation
// and diacritics go: "TREATMENT ROOMS →" → "TREATMENT ROOMS", "Señoras" → "SENORAS".
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9&/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Glyph pairs OCR (and image models) confuse. Applied to BOTH sides before a lenient
// compare, so "2O4" still finds "204" — flagged as ambiguous, never silently.
const CONFUSIONS: Array<[RegExp, string]> = [
  [/[OQD]/g, "0"],
  [/[IL]/g, "1"],
  [/Z/g, "2"],
  [/S/g, "5"],
  [/G/g, "6"],
  [/B/g, "8"],
];
export function lenientKey(s: string): string {
  let k = normalizeText(s);
  for (const [re, to] of CONFUSIONS) k = k.replace(re, to);
  return k;
}

interface Entry {
  line: OcrLine;
  tokens: string[];
  candidates: string[];
}

const key = (t: string, lenient: boolean) => (lenient ? lenientKey(t) : t);

// Finds `exp` (normalized, space-separated tokens) as a whole-token window inside
// one entry's remaining tokens; consumes the window on success.
function takeFromEntry(e: Entry, exp: string, lenient: boolean): boolean {
  const want = key(exp, lenient).split(" ");
  const n = want.length;
  for (let i = 0; i + n <= e.tokens.length; i++) {
    const window = e.tokens.slice(i, i + n).map((t) => key(t, lenient));
    if (window.every((t, j) => t === want[j])) {
      e.tokens.splice(i, n);
      return true;
    }
  }
  return false;
}

// Same, but the tokens may be spread over several entries in reading order (OCR
// split "TREATMENT ROOMS" into two lines). All-or-nothing.
function takeAcrossEntries(
  entries: Entry[],
  exp: string,
  lenient: boolean,
): Entry[] | null {
  const want = key(exp, lenient).split(" ");
  const snapshot = entries.map((e) => [...e.tokens]);
  const used: Entry[] = [];
  let wi = 0;
  let ei = 0;
  while (wi < want.length && ei < entries.length) {
    const e = entries[ei];
    const ti = e.tokens.findIndex((t) => key(t, lenient) === want[wi]);
    if (ti === -1) {
      ei++;
      continue;
    }
    // consume as many consecutive wanted tokens as this entry holds
    let count = 0;
    while (
      wi + count < want.length &&
      ti + count < e.tokens.length &&
      key(e.tokens[ti + count], lenient) === want[wi + count]
    ) {
      count++;
    }
    e.tokens.splice(ti, count);
    used.push(e);
    wi += count;
    ei++;
  }
  if (wi === want.length) return used;
  entries.forEach((e, i) => {
    e.tokens = snapshot[i];
  });
  return null;
}

export function checkExpectedText(
  expected: ExpectedText,
  ocr: OcrResult,
  opts: TextCheckOptions = {},
): TextCheck {
  const minTextHeight = opts.minTextHeight ?? 0.015;
  const minConfidence = opts.minConfidence ?? 0.3;
  const pieces = expected.pieces.map((p) =>
    p.map(normalizeText).filter((t) => t !== ""),
  );
  const layout =
    expected.layout ?? (pieces.length > 1 ? "row" : ("single" as const));
  const checkOrder =
    opts.checkOrder ?? (pieces.length > 1 && layout !== "single");

  // Reading order: top→bottom, then left→right.
  const entries: Entry[] = ocr.lines
    .filter((l) => l.confidence >= minConfidence)
    .map((l) => ({
      line: l,
      tokens: normalizeText(l.text).split(" ").filter(Boolean),
      candidates: (l.candidates ?? []).slice(1).map(normalizeText),
    }))
    .sort(
      (a, b) => a.line.bbox.y - b.line.bbox.y || a.line.bbox.x - b.line.bbox.x,
    );

  const findings: TextLineFinding[] = [];
  const positions: (number | null)[] = pieces.map(() => null);
  const axis = (e: Entry) =>
    layout === "stack"
      ? e.line.bbox.y + e.line.bbox.h / 2
      : e.line.bbox.x + e.line.bbox.w / 2;

  pieces.forEach((lines, pi) => {
    for (const exp of lines) {
      let hits: Entry[] | null = null;
      let strict = false;
      // 1 · verbatim in one line, 2 · verbatim across lines, 3 · lenient in one
      // line, 4 · lenient across lines, 5 · an alternative OCR candidate.
      for (const lenient of [false, true]) {
        const one = entries.find((e) => takeFromEntry(e, exp, lenient));
        if (one) {
          hits = [one];
          strict = !lenient;
          break;
        }
        const many = takeAcrossEntries(entries, exp, lenient);
        if (many) {
          hits = many;
          strict = !lenient;
          break;
        }
      }
      if (!hits) {
        const cand = entries.find(
          (e) =>
            e.tokens.length > 0 &&
            e.candidates.some(
              (c) => ` ${c} `.includes(` ${exp} `) || c === exp,
            ),
        );
        if (cand) {
          cand.tokens = [];
          hits = [cand];
        }
      }
      if (!hits) {
        findings.push({
          piece: pi,
          expected: exp,
          found: false,
          strict: false,
          matchedLine: null,
          height: null,
          confidence: null,
          tooSmall: false,
        });
        continue;
      }
      const height = Math.min(...hits.map((h) => h.line.bbox.h));
      const confidence = Math.min(...hits.map((h) => h.line.confidence));
      findings.push({
        piece: pi,
        expected: exp,
        found: true,
        strict,
        matchedLine: hits.map((h) => h.line.text).join(" | "),
        height,
        confidence,
        tooSmall: height < minTextHeight,
      });
      const pos = Math.min(...hits.map(axis));
      positions[pi] =
        positions[pi] === null ? pos : Math.min(positions[pi] as number, pos);
    }
  });

  const missing = findings.filter((f) => !f.found).map((f) => f.expected);
  const ambiguous = findings
    .filter((f) => f.found && !f.strict)
    .map((f) => f.expected);
  const tooSmall = findings.filter((f) => f.tooSmall).map((f) => f.expected);
  const extraText = [
    ...new Set(entries.flatMap((e) => e.tokens).filter((t) => t.length >= 2)),
  ];

  let orderOk: boolean | null = null;
  if (checkOrder && positions.every((p) => p !== null)) {
    orderOk = positions.every(
      (p, i) => i === 0 || (p as number) >= (positions[i - 1] as number),
    );
  }

  const problems: string[] = [];
  for (const f of findings) {
    if (!f.found)
      problems.push(`missing "${f.expected}" (piece ${f.piece + 1})`);
    else if (f.tooSmall)
      problems.push(
        `"${f.expected}" too small: ${(100 * (f.height ?? 0)).toFixed(1)} % of the height (min ${(100 * minTextHeight).toFixed(1)} %)`,
      );
  }
  if (orderOk === false)
    problems.push(
      `pieces out of order (${layout === "stack" ? "top→bottom" : "left→right"})`,
    );
  if (opts.failOnExtraText && extraText.length)
    problems.push(`extra text: ${extraText.join(", ")}`);

  return {
    pass: problems.length === 0,
    engine: ocr.engine,
    lines: findings,
    missing,
    ambiguous,
    tooSmall,
    extraText,
    orderOk,
    problems,
  };
}

// A take's check (ROADMAP Phase 10, on the board): what Kiln read in a
// generated image against the reference it edited, written when the take
// lands. Text and letterforms are measured; the scale is only said, since no
// local check can see the door it is measured against.
export const TakeCheckLine = z.object({
  expected: z.string(),
  found: z.boolean(),
  // read: as one line; stack: one piece at a time, re-laid in a row;
  // ambiguous: only through a look-alike glyph or another reading.
  how: z.enum(["read", "stack", "ambiguous"]).optional(),
  // Fraction of the frame height.
  height: z.number().optional(),
  tooSmall: z.boolean().optional(),
  // The take's stroke and width over the reference's (1 = the same).
  letters: z.object({ stroke: z.number(), width: z.number() }).optional(),
});
export type TakeCheckLine = z.infer<typeof TakeCheckLine>;

export const TakeCheck = z.object({
  status: z.enum(["passed", "failed", "unchecked"]),
  engine: z.string().optional(),
  lines: z.array(TakeCheckLine).default([]),
  problems: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  // The size the scene asked for, which nothing verified.
  scale: z.string().optional(),
  // Why nothing was checked.
  unchecked: z.string().optional(),
  checkedAt: z.string(),
});
export type TakeCheck = z.infer<typeof TakeCheck>;

// A stored check, or null when there is none or it no longer reads.
export function readTakeCheck(value: unknown): TakeCheck | null {
  return TakeCheck.safeParse(value).data ?? null;
}

export interface TakeLineReading {
  expected: string;
  // The reference reads it: only then can the take be held to it.
  inReference: boolean;
  found: boolean;
  how?: "read" | "stack" | "ambiguous";
  height?: number;
  letters?: LetterComparison;
}

const ratio = (n: number) => n.toFixed(2);

// The check from what was read: a promised line the take misses, reads too
// small, or draws in another weight fails it; a line the reference itself
// does not read is not held against the take; the rest is said as notes.
export function judgeTake(input: {
  lines: TakeLineReading[];
  engine: string;
  scale?: string;
  minTextHeight?: number;
  checkedAt: string;
}): TakeCheck {
  const minTextHeight = input.minTextHeight ?? 0.015;
  const problems: string[] = [];
  const notes: string[] = [];
  const lines: TakeCheckLine[] = [];
  for (const l of input.lines) {
    if (!l.inReference) {
      notes.push(
        `"${l.expected}" not checked: the reference does not read it either`,
      );
      continue;
    }
    const tooSmall = l.found && (l.height ?? 0) < minTextHeight;
    lines.push({
      expected: l.expected,
      found: l.found,
      ...(l.how ? { how: l.how } : {}),
      ...(l.height !== undefined ? { height: l.height } : {}),
      ...(tooSmall ? { tooSmall } : {}),
      ...(l.letters
        ? {
            letters: {
              stroke: l.letters.take.stroke / l.letters.reference.stroke,
              width: l.letters.take.width / l.letters.reference.width,
            },
          }
        : {}),
    });
    if (!l.found) {
      problems.push(`missing "${l.expected}"`);
      continue;
    }
    if (tooSmall)
      problems.push(
        `"${l.expected}" too small: ${(100 * (l.height ?? 0)).toFixed(1)} % of the height (min ${(100 * minTextHeight).toFixed(1)} %)`,
      );
    if (l.how === "stack")
      notes.push(`"${l.expected}" read one piece at a time, as a stack`);
    if (l.how === "ambiguous")
      notes.push(`"${l.expected}" read only loosely (O/0, I/1, S/5…)`);
    const c = l.letters;
    if (c && !c.strokeOk)
      problems.push(
        `"${l.expected}" letters ${c.take.stroke > c.reference.stroke ? "thicker" : "thinner"} than the reference: stroke ${ratio(c.take.stroke)} vs ${ratio(c.reference.stroke)} of their height`,
      );
    if (c && !c.widthOk)
      notes.push(
        `"${l.expected}" letters ${c.take.width > c.reference.width ? "wider" : "narrower"} than the reference (${ratio(c.take.width)} vs ${ratio(c.reference.width)} of their height); an angled camera narrows them too`,
      );
  }
  const base = {
    engine: input.engine,
    lines,
    notes,
    ...(input.scale ? { scale: input.scale } : {}),
    checkedAt: input.checkedAt,
  };
  if (lines.length === 0) {
    return {
      ...base,
      status: "unchecked",
      problems: [],
      unchecked:
        input.lines.length === 0
          ? "no wording to read"
          : "the reference shows no wording it can read",
    };
  }
  return {
    ...base,
    status: problems.length > 0 ? "failed" : "passed",
    problems,
  };
}

// A take nothing could read (no OCR engine here, an image it cannot open):
// the scale is still said.
export function uncheckedTake(
  reason: string,
  checkedAt: string,
  scale?: string,
): TakeCheck {
  return {
    status: "unchecked",
    lines: [],
    problems: [],
    notes: [],
    unchecked: reason,
    ...(scale ? { scale } : {}),
    checkedAt,
  };
}

// The board's chip: "checked · text 2/2 · letters match".
export function takeCheckLabel(check: TakeCheck): string {
  if (check.status === "unchecked")
    return `unchecked · ${check.unchecked ?? "nothing to read"}`;
  if (check.status === "failed")
    return `check failed · ${check.problems[0] ?? "see the take"}`;
  const n = check.lines.length;
  const measured = check.lines.some((l) => l.letters);
  return `checked · text ${n}/${n}${measured ? " · letters match" : ""}`;
}

// The reason chip a failed check points to, when one moves a knob that helps.
export function suggestedReason(check: TakeCheck): ReasonKey | null {
  return check.lines.some((l) => l.tooSmall) ? "small" : null;
}
