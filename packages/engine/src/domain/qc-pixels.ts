// Pixel measures for the take check. Pure: an RGBA image in, numbers out;
// decoding and OCR live outside the engine. Two measures the OCR cannot give:
// where pieces stand when each is one character (Apple Vision drops a lone "0",
// DOGFOOD #84), and the letterforms' weight and width against the reference's
// (a font product's buyers notice a thicker stroke, #82).

export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

// In pixels of the image measured, origin top-left.
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InkComponent extends PixelRect {
  area: number;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

// The 8-connected blobs of pixels near an ink colour (within `tolerance` in
// RGB): each loose letter, or each word engraved in a colour.
export function inkComponents(
  img: RgbaImage,
  ink: string,
  tolerance = 90,
): InkComponent[] {
  const { width: w, height: h, pixels: px } = img;
  const [r, g, b] = rgb(ink);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.hypot(px[4 * i] - r, px[4 * i + 1] - g, px[4 * i + 2] - b);
    if (d < tolerance) mask[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const found: InkComponent[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    while (stack.length > 0) {
      const j = stack.pop() as number;
      const x = j % w;
      const y = (j - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (mask[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    found.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  return found;
}

const MAX_STACK = 6;
const CANDIDATES = 20;

// `count` blobs stacked in one column, top to bottom: of similar height
// (within 40 % of their mean), centred on one vertical line (within half that
// height), none overlapping the next and no gap over 1.5 heights. The best
// aligned set, or null. Blobs under `minHeight` of the image (grain, a stray
// shadow) are passed over, and only the largest are tried.
export function stackedRun(
  components: InkComponent[],
  count: number,
  imageHeight: number,
  minHeight = 0.03,
): InkComponent[] | null {
  if (count < 2 || count > MAX_STACK) return null;
  const pool = components
    .filter((c) => c.h >= imageHeight * minHeight && c.area >= 20)
    .sort((a, b) => b.area - a.area)
    .slice(0, CANDIDATES)
    .sort((a, b) => a.y - b.y);
  const best: { score: number; set: InkComponent[] | null } = {
    score: Number.POSITIVE_INFINITY,
    set: null,
  };
  const score = (set: InkComponent[]) => {
    const mh = set.reduce((s, c) => s + c.h, 0) / set.length;
    const centres = set.map((c) => c.x + c.w / 2);
    const mx = centres.reduce((s, x) => s + x, 0) / set.length;
    let total = 0;
    for (let i = 0; i < set.length; i++) {
      const dh = Math.abs(set[i].h - mh) / mh;
      const dx = Math.abs(centres[i] - mx) / mh;
      if (dh > 0.4 || dx > 0.5) return Number.POSITIVE_INFINITY;
      if (i > 0) {
        const gap = set[i].y - (set[i - 1].y + set[i - 1].h);
        if (gap < 0 || gap > 1.5 * mh) return Number.POSITIVE_INFINITY;
      }
      total += dh + dx;
    }
    return total / set.length;
  };
  const pick: InkComponent[] = [];
  const walk = (from: number) => {
    if (pick.length === count) {
      const s = score(pick);
      if (s < best.score) {
        best.score = s;
        best.set = [...pick];
      }
      return;
    }
    for (let i = from; i <= pool.length - (count - pick.length); i++) {
      pick.push(pool[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best.set;
}

export interface Letterform {
  // The stroke (median of each ink pixel's shorter run across it) and the
  // ink's width, each over the ink's height: the same at any size.
  stroke: number;
  width: number;
  // The ink's height in pixels.
  height: number;
}

// The letterforms inside a text box: an Otsu threshold on luminance, the ink
// the smaller class (dark on light or light on dark), then the stroke and the
// width against the height. Null when the box holds too little ink to judge.
export function letterform(img: RgbaImage, box: PixelRect): Letterform | null {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(img.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(img.height, Math.ceil(box.y + box.h));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 4 || bh < 8) return null;
  const n = bw * bh;
  const lum = new Uint8Array(n);
  const hist = new Array<number>(256).fill(0);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = 4 * ((y0 + y) * img.width + x0 + x);
      const v = Math.round(
        0.299 * img.pixels[i] +
          0.587 * img.pixels[i + 1] +
          0.114 * img.pixels[i + 2],
      );
      lum[y * bw + x] = v;
      hist[v]++;
    }
  }
  const threshold = otsu(hist, n);
  let dark = 0;
  for (let i = 0; i < n; i++) if (lum[i] <= threshold) dark++;
  const inkIsDark = dark <= n / 2;
  const ink = new Uint8Array(n);
  let inkCount = 0;
  let ix0 = bw;
  let iy0 = bh;
  let ix1 = -1;
  let iy1 = -1;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const on = inkIsDark ? lum[i] <= threshold : lum[i] > threshold;
      if (!on) continue;
      ink[i] = 1;
      inkCount++;
      if (x < ix0) ix0 = x;
      if (x > ix1) ix1 = x;
      if (y < iy0) iy0 = y;
      if (y > iy1) iy1 = y;
    }
  }
  if (inkCount < 30) return null;
  const height = iy1 - iy0 + 1;
  const width = ix1 - ix0 + 1;
  if (height < 8) return null;
  const across = new Uint16Array(n);
  for (let y = 0; y < bh; y++) {
    let x = 0;
    while (x < bw) {
      if (!ink[y * bw + x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < bw && ink[y * bw + end]) end++;
      for (let k = x; k < end; k++) across[y * bw + k] = end - x;
      x = end;
    }
  }
  const runs: number[] = [];
  for (let x = 0; x < bw; x++) {
    let y = 0;
    while (y < bh) {
      if (!ink[y * bw + x]) {
        y++;
        continue;
      }
      let end = y;
      while (end < bh && ink[end * bw + x]) end++;
      for (let k = y; k < end; k++)
        runs.push(Math.min(across[k * bw + x], end - y));
      y = end;
    }
  }
  runs.sort((a, b) => a - b);
  const stroke = runs[Math.floor(runs.length / 2)];
  return { stroke: stroke / height, width: width / height, height };
}

function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumBelow = 0;
  let below = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    below += hist[t];
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    sumBelow += t * hist[t];
    const spread =
      below * above * (sumBelow / below - (sum - sumBelow) / above) ** 2;
    if (spread > best) {
      best = spread;
      threshold = t;
    }
  }
  return threshold;
}

// How far a take's letterforms may stray from the reference's: a heavier or
// lighter weight shows in the stroke (measured: the same font in a scene
// within 9 %, the next weight up 40 % or more); the width also moves with
// an angled camera, so it is only noted.
export const LETTER_TOLERANCE = { stroke: 0.25, width: 0.2 } as const;

export interface LetterComparison {
  take: Letterform;
  reference: Letterform;
  strokeOk: boolean;
  widthOk: boolean;
}

// Under four pixels of stroke, one pixel either way is a quarter of it:
// letters that small cannot tell one weight from the next.
export const MIN_STROKE_PX = 4;

// The take's letterforms against the reference's, or null when the take's
// letters are too small for the stroke to be told apart.
export function compareLetterforms(
  take: Letterform,
  reference: Letterform,
): LetterComparison | null {
  if (take.height * reference.stroke < MIN_STROKE_PX) return null;
  const within = (a: number, b: number, tolerance: number) =>
    Math.abs(a / b - 1) <= tolerance;
  return {
    take,
    reference,
    strokeOk: within(take.stroke, reference.stroke, LETTER_TOLERANCE.stroke),
    widthOk: within(take.width, reference.width, LETTER_TOLERANCE.width),
  };
}
