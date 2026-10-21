import { textWidth, wrapText } from "@/components/projects/text-fit";

// The Size & spec sheet's layout, as plain geometry (tested without a
// browser): the drawing with its measures, then a row per fact, each label
// and value on at most two lines inside the frame. The drawing shrinks and
// the type steps down until every row sits above the bottom; a fact the
// sheet may skip (a long visual brief as the shape or material) is left out
// rather than cut, since the drawing shows it.

export interface SpecFact {
  label: string;
  value: string;
  droppable?: boolean;
}

export interface SizeSpecRow {
  label: string[];
  value: string[];
  // Baseline of the first line; the rest follow every `lineHeight`.
  y: number;
}

export interface SizeSpecLayout {
  box: { x: number; y: number; w: number; h: number };
  fontSize: number;
  lineHeight: number;
  labelX: number;
  valueX: number;
  rows: SizeSpecRow[];
}

export const LABEL_SIZE = 10;
export const LABEL_SPACING = 1;
const LABEL_X = 40;
const VALUE_X = 148;
const RIGHT = 32;
const SIDE = 24;
const BOX_TOP = 92;
const MEASURE = 12;
const MEASURE_GAP = 26;
const MONO = 0.62;
const ROW_GAP = 6;
const SHARES = [0.3, 0.26, 0.22, 0.18];
const SIZES = [13, 12, 11];

export function sizeSpecLayout(input: {
  width: number;
  height: number;
  // The drawing's proportions (the product's measures).
  product: { width: number; height: number };
  // The height measure printed beside the drawing ("2.78 in").
  heightLabel: string;
  facts: SpecFact[];
  depth: boolean;
}): SizeSpecLayout {
  const { width, height } = input;
  const bottom = input.depth ? height - 44 : height - 16;
  const side = MEASURE_GAP + input.heightLabel.length * MEASURE * MONO;
  const boxMaxW = width - 2 * SIDE - side;
  const labelMax = VALUE_X - LABEL_X - 12;
  const valueMax = width - RIGHT - VALUE_X;

  const attempt = (share: number, fontSize: number, dropAll: boolean) => {
    const scale = Math.min(
      boxMaxW / input.product.width,
      (height * share) / input.product.height,
    );
    const w = input.product.width * scale;
    const h = input.product.height * scale;
    const box = { x: (width - w - side) / 2, y: BOX_TOP, w, h };
    const lineHeight = fontSize + 4;
    const rows: SizeSpecRow[] = [];
    let y = box.y + h + 62;
    let last = y;
    for (const fact of input.facts) {
      const value = wrapText(fact.value, valueMax, fontSize, 2);
      if (fact.droppable && (dropAll || !value.fits)) continue;
      const label = wrapText(
        fact.label.toUpperCase(),
        labelMax,
        LABEL_SIZE,
        2,
        LABEL_SPACING,
      );
      const lines = Math.max(label.lines.length, value.lines.length);
      rows.push({ label: label.lines, value: value.lines, y });
      last = y + (lines - 1) * lineHeight;
      y = last + lineHeight + ROW_GAP;
    }
    return {
      fits: last <= bottom,
      layout: {
        box,
        fontSize,
        lineHeight,
        labelX: LABEL_X,
        valueX: VALUE_X,
        rows,
      },
    };
  };

  for (const share of SHARES) {
    for (const fontSize of SIZES) {
      const tried = attempt(share, fontSize, false);
      if (tried.fits) return tried.layout;
    }
  }
  return attempt(SHARES.at(-1) ?? 0.18, SIZES.at(-1) ?? 11, true).layout;
}

// How wide a label line draws (for tests and callers that check the frame).
export const labelWidth = (line: string) =>
  textWidth(line, LABEL_SIZE, LABEL_SPACING);
