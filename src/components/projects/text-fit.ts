// Text measured without a browser, for frames drawn the same on the board
// and through resvg at Deliver: a conservative width per glyph, and text
// wrapped by words into the lines a width allows.

const GLYPH = 0.58;
// Fraunces italic runs narrower: ~0.39 em measured, 0.45 kept conservative.
export const SERIF_ITALIC_GLYPH = 0.45;

// A conservative width estimate for sans text (no DOM to measure): average
// glyph ~0.58 em, plus any letter spacing. `glyph` for another face.
export function textWidth(
  text: string,
  fontSize: number,
  letterSpacing = 0,
  glyph = GLYPH,
): number {
  return text.length * (fontSize * glyph + letterSpacing);
}

// Cut `text` to fit `maxWidth`, ending it with "…".
function ellipsize(
  text: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number,
  glyph: number,
): string {
  let cut = text;
  while (
    cut.length > 1 &&
    textWidth(`${cut}…`, fontSize, letterSpacing, glyph) > maxWidth
  ) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

// `text` as at most `maxLines` lines of words that each fit `maxWidth`; a
// word too long for a line is cut, and the last line ends with "…" when the
// text runs over. `fits` says whether it all fit uncut.
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  letterSpacing = 0,
  glyph = GLYPH,
): { lines: string[]; fits: boolean } {
  const width = (t: string) => textWidth(t, fontSize, letterSpacing, glyph);
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (width(next) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (width(line) > maxWidth) {
      let cut = line;
      while (cut.length > 1 && width(cut) > maxWidth) cut = cut.slice(0, -1);
      lines.push(cut);
      line = line.slice(cut.length);
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return { lines, fits: true };
  const kept = lines.slice(0, maxLines);
  const rest = lines.slice(maxLines - 1).join(" ");
  kept[maxLines - 1] = ellipsize(
    rest,
    maxWidth,
    fontSize,
    letterSpacing,
    glyph,
  );
  return { lines: kept, fits: false };
}
