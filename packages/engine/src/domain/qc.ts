// QC v2 — text fidelity (ROADMAP Phase 10). Pure: takes what the plate promised
// (expectedText per piece, the layout) and what an OCR engine read from the
// generated image, and says whether every promised line is there, legible and in
// order. OCR engines live outside the engine (scripts/ocr.mjs: Apple Vision on
// macOS); they only have to produce an OcrResult. Nothing here touches the network.

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
