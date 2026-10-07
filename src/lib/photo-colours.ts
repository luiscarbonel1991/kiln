// A product photo's own colours, from its pixels (RGB, `size` x `size`): the
// colours the centre of the frame has much more of than its edge — the wall,
// the table or the hand holding the piece reach the edge, the piece rarely
// does. Without that, a piece shot on a wall reads as the wall's greys. Free
// (no model): a starting point the maker edits. Small marks the colour of the
// background (white letters on a white wall) are lost; "Fill from the photo"
// reads them.

type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const distance = (a: Rgb, b: Rgb) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

// Pixels grouped by colour (4 bits a channel), then the groups closer than
// SAME joined into one colour (a shade, the light falling across a face),
// most covered first, each with its mean colour.
function clusters(pixels: Rgb[]): { colour: Rgb; count: number }[] {
  const groups = new Map<number, { sum: Rgb; count: number }>();
  for (const [r, g, b] of pixels) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const group = groups.get(key) ?? { sum: [0, 0, 0], count: 0 };
    group.sum[0] += r;
    group.sum[1] += g;
    group.sum[2] += b;
    group.count += 1;
    groups.set(key, group);
  }
  const joined: { sum: Rgb; count: number }[] = [];
  const mean = (c: { sum: Rgb; count: number }): Rgb => [
    c.sum[0] / c.count,
    c.sum[1] / c.count,
    c.sum[2] / c.count,
  ];
  for (const group of [...groups.values()].sort((a, b) => b.count - a.count)) {
    const into = joined.find((c) => distance(mean(c), mean(group)) < SAME);
    if (into) {
      into.sum[0] += group.sum[0];
      into.sum[1] += group.sum[1];
      into.sum[2] += group.sum[2];
      into.count += group.count;
    } else {
      joined.push({ sum: [...group.sum] as Rgb, count: group.count });
    }
  }
  return joined
    .map((c) => ({ colour: mean(c), count: c.count }))
    .sort((a, b) => b.count - a.count);
}

// Colours closer than this are one colour (a shade, the light falling across
// a face).
const SAME = 48;
// Colours this close count as the same when comparing the centre with the edge.
const NEAR = 48;
// A colour must cover at least this share of the centre to count.
const MIN_SHARE = 0.03;
// The piece is what the centre has much more of than the edge: the wall, the
// table or the hand that holds it reach the edge, the product rarely does.
const CENTRE_OVER_EDGE = 2;
// A further colour must cover at least this share of what the first covers
// (the light across a face makes thin bands of a lighter shade).
const PROMINENCE = 0.35;

export function productColours(
  pixels: Uint8Array,
  size: number,
  max = 4,
): string[] {
  const at = (x: number, y: number): Rgb => {
    const i = (y * size + x) * 3;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  const ring = Math.max(1, Math.round(size * 0.08));
  const edge: Rgb[] = [];
  const centre: Rgb[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < ring || y < ring || x >= size - ring || y >= size - ring) {
        edge.push(at(x, y));
      }
      if (
        x >= size * 0.25 &&
        x < size * 0.75 &&
        y >= size * 0.25 &&
        y < size * 0.75
      ) {
        centre.push(at(x, y));
      }
    }
  }
  const inEdge = (colour: Rgb) =>
    edge.filter((p) => distance(p, colour) < NEAR).length / edge.length;
  const candidates = clusters(centre)
    .map((c) => ({ colour: c.colour, inCentre: c.count / centre.length }))
    .filter((c) => c.inCentre >= MIN_SHARE);
  const pick = (onlyPiece: boolean) => {
    const chosen: { colour: Rgb; inCentre: number }[] = [];
    for (const c of candidates) {
      if (chosen.length >= max) break;
      if (onlyPiece && c.inCentre < CENTRE_OVER_EDGE * inEdge(c.colour)) {
        continue;
      }
      if (chosen.length > 0 && c.inCentre < PROMINENCE * chosen[0].inCentre) {
        continue;
      }
      chosen.push(c);
    }
    return chosen.map((c) => c.colour);
  };
  // A piece the colour of its surroundings keeps its own colour.
  const chosen = pick(true);
  return (chosen.length > 0 ? chosen : pick(false)).map(hex);
}
