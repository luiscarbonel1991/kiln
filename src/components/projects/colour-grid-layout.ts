// The colour sheet's layout, as plain geometry (tested without a browser):
// as many columns as the names allow, each name on at most two lines, the
// font no smaller than 11 px, and the swatches sized so every row — swatch,
// name and stock note — fits the frame without touching the next one.

export interface ColourCell {
  cx: number;
  swatchY: number;
  lines: string[];
  // Baseline of the first name line; the rest follow every `lineHeight`.
  nameY: number;
  // Baseline of the "out of stock" note, when there is one.
  stockY?: number;
}

export interface ColourGridLayout {
  cols: number;
  pitch: number;
  swatch: number;
  fontSize: number;
  lineHeight: number;
  cells: ColourCell[];
}

interface Frame {
  names: string[];
  inStock: boolean[];
  width: number;
  height: number;
  top: number;
}

const MARGIN = 28;
const SWATCH_MAX = 96;
const SWATCH_MIN = 36;
const NAME_GAP = 8;
const STOCK_LINE = 14;
const ROW_GAP = 14;
const COL_GAP = 12;
const GLYPH = 0.58;

// A conservative width estimate for the sans semibold label (no DOM to
// measure): average glyph ~0.58 em.
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * GLYPH;
}

// Split a name into at most two lines that each fit `maxWidth`, breaking at
// the space nearest the middle; null when it cannot fit.
export function wrapName(
  name: string,
  maxWidth: number,
  fontSize: number,
): string[] | null {
  if (textWidth(name, fontSize) <= maxWidth) return [name];
  const spaces = [...name.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (spaces.length === 0) return null;
  const middle = name.length / 2;
  const at = spaces.reduce((a, b) =>
    Math.abs(b - middle) < Math.abs(a - middle) ? b : a,
  );
  const lines = [name.slice(0, at), name.slice(at + 1)];
  return lines.every((l) => textWidth(l, fontSize) <= maxWidth) ? lines : null;
}

function columnChoices(n: number): number[] {
  if (n <= 3) return [n];
  if (n === 4) return [2, 4];
  return [3, 4, 2];
}

// The swatch side that fits `rows` rows of swatch + label in the frame.
function swatchFor(
  frame: Frame,
  pitch: number,
  rows: number,
  label: number,
): number {
  const available = frame.height - frame.top - 16;
  return Math.floor(
    Math.min(
      SWATCH_MAX,
      pitch - COL_GAP * 2,
      (available - (rows - 1) * ROW_GAP) / rows - label,
    ),
  );
}

function place(
  frame: Frame,
  cols: number,
  fontSize: number,
  lines: string[][],
): ColourGridLayout {
  const n = frame.names.length;
  const pitch = (frame.width - MARGIN * 2) / cols;
  const lineHeight = Math.round(fontSize * 1.2);
  const rows = Math.ceil(n / cols);
  const anyOut = frame.inStock.some((s) => !s);
  const maxLines = Math.max(...lines.map((l) => l.length));
  const label = NAME_GAP + maxLines * lineHeight + (anyOut ? STOCK_LINE : 0);
  const swatch = Math.max(16, swatchFor(frame, pitch, rows, label));
  const available = frame.height - frame.top - 16;
  const rowHeight = swatch + label;
  const gridHeight = rows * rowHeight + (rows - 1) * ROW_GAP;
  const y0 = frame.top + Math.max(0, (available - gridHeight) / 2);
  return {
    cols,
    pitch,
    swatch,
    fontSize,
    lineHeight,
    cells: frame.names.map((_name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // A short last row is centred under the full ones.
      const inRow = row === rows - 1 ? n - row * cols : cols;
      const cx = frame.width / 2 + (col - (inRow - 1) / 2) * pitch;
      const swatchY = y0 + row * (rowHeight + ROW_GAP);
      const nameY = swatchY + swatch + NAME_GAP + fontSize;
      return {
        cx,
        swatchY,
        lines: lines[i],
        nameY,
        ...(frame.inStock[i]
          ? {}
          : { stockY: nameY + (lines[i].length - 1) * lineHeight + 13 }),
      };
    }),
  };
}

export function colourGridLayout(frame: Frame): ColourGridLayout {
  const n = frame.names.length;
  let best: ColourGridLayout | null = null;
  for (const cols of columnChoices(n)) {
    for (let fontSize = 14; fontSize >= 11; fontSize--) {
      const pitch = (frame.width - MARGIN * 2) / cols;
      const wrapped = frame.names.map((name) =>
        wrapName(name, pitch - COL_GAP, fontSize),
      );
      if (wrapped.some((w) => w === null)) continue;
      const candidate = place(frame, cols, fontSize, wrapped as string[][]);
      if (candidate.swatch < SWATCH_MIN) continue;
      if (
        !best ||
        candidate.swatch > best.swatch ||
        (candidate.swatch === best.swatch && fontSize > best.fontSize)
      ) {
        best = candidate;
      }
    }
  }
  if (best) return best;
  // Nothing fits the rules (very many colours, or one long word): the
  // densest layout at the smallest font, names cut to their column.
  const cols = Math.max(...columnChoices(n));
  const pitch = (frame.width - MARGIN * 2) / cols;
  const maxChars = Math.max(3, Math.floor((pitch - COL_GAP) / (11 * GLYPH)));
  const cut = frame.names.map((name) => [
    name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name,
  ]);
  return place(frame, cols, 11, cut);
}
