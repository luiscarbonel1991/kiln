// A material photo checked against its colour's swatch, free (no model): how
// far apart they are, and the per-channel gains that correct the photo, either
// to make a white or grey spot neutral (white balance) or to bring its colour
// to the swatch (the maker said the swatch is the truth). Gains on sRGB values
// are gains in linear light too, so the correction keeps the grain.

export type Rgb = [number, number, number];
export type Gains = { gains: Rgb } | { refused: string };

export function rgbOf(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lab([r, g, b]: Rgb): Rgb {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  // D65 white.
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : (t * 841) / 108 + 4 / 29;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// ΔE (CIE76): about 2 is the least an eye sees side by side.
export function colourDifference(a: string, b: string): number {
  const [l1, a1, b1] = lab(rgbOf(a));
  const [l2, a2, b2] = lab(rgbOf(b));
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// Under this, the photo and the swatch read as one colour.
export const SAME_COLOUR = 5;

// The gains that make the tapped spot neutral at its own brightness. A spot
// too dark, blown out or plainly coloured is refused: it would tint the whole
// photo.
export function whiteGains(spot: Rgb): Gains {
  const max = Math.max(...spot);
  const min = Math.min(...spot);
  if (max < 40) {
    return {
      refused:
        "That spot is too dark: tap something white or grey in good light.",
    };
  }
  if (max >= 250) {
    return {
      refused:
        "That spot is blown out: tap a grey area, or shoot with less light.",
    };
  }
  if ((max - min) / max > 0.35) {
    return { refused: "That spot has colour: tap something white or grey." };
  }
  const grey = (spot[0] + spot[1] + spot[2]) / 3;
  return { gains: [grey / spot[0], grey / spot[1], grey / spot[2]] };
}

// The gains that bring the photo's colour to the swatch. Too far apart and the
// photo is refused rather than stretched: a photo that far off needs a new
// shot in even light.
export function matchGains(photo: string, swatch: string): Gains {
  const from = rgbOf(photo);
  const to = rgbOf(swatch);
  const tooFar = {
    refused:
      "The photo is too far from the swatch to correct: shoot it again in even light.",
  };
  if (from.some((v) => v < 8)) return tooFar;
  const gains = to.map((v, i) => v / from[i]) as Rgb;
  return gains.every((g) => g >= 0.4 && g <= 2.5) ? { gains } : tooFar;
}
