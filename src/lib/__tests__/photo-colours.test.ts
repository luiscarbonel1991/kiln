import { describe, expect, it } from "vitest";
import { productColours } from "@/lib/photo-colours";

const SIZE = 48;

// A photo as RGB pixels: `paint(x, y)` returns each pixel's colour.
function photo(paint: (x: number, y: number) => [number, number, number]) {
  const pixels = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      pixels.set(paint(x, y), (y * SIZE + x) * 3);
    }
  }
  return pixels;
}

const WALL: [number, number, number] = [163, 161, 159];
const BLACK: [number, number, number] = [23, 24, 27];
const WHITE: [number, number, number] = [213, 218, 223];

describe("productColours", () => {
  it("reads the piece's face, not the wall around it nor its small marks", () => {
    // A black plate with white lettering, centred on a grey wall: the face is
    // the colour option; the lettering is a mark on it.
    const pixels = photo((x, y) => {
      const onPlate = x >= 14 && x < 34 && y >= 16 && y < 32;
      const onLetters = onPlate && y >= 22 && y < 26 && x >= 18 && x < 30;
      return onLetters ? WHITE : onPlate ? BLACK : WALL;
    });
    expect(productColours(pixels, SIZE)).toEqual(["#17181B"]);
  });

  it("keeps two colours that both make the face", () => {
    // A board half walnut, half maple.
    const pixels = photo((x, y) =>
      x >= 12 && x < 36 && y >= 12 && y < 36
        ? x < 24
          ? [91, 58, 41]
          : [227, 201, 160]
        : WALL,
    );
    expect(productColours(pixels, SIZE)).toEqual(["#5B3A29", "#E3C9A0"]);
  });

  it("leaves out what reaches the edge, like the hand holding the piece", () => {
    const SKIN: [number, number, number] = [196, 140, 112];
    // A black plate held by a hand that comes in from the bottom left.
    const pixels = photo((x, y) => {
      if (x >= 16 && x < 33 && y >= 12 && y < 26) return BLACK;
      if (x < 31 && y >= 26) return SKIN;
      return WALL;
    });
    expect(productColours(pixels, SIZE)).toEqual(["#17181B"]);
  });

  it("merges shades of one colour", () => {
    const pixels = photo((x, y) =>
      x >= 12 && x < 36 && y >= 12 && y < 36
        ? x % 2
          ? [90, 60, 40]
          : [100, 66, 46]
        : [245, 245, 245],
    );
    expect(productColours(pixels, SIZE)).toHaveLength(1);
  });

  it("a piece the colour of its background keeps its colour", () => {
    const pixels = photo(() => [47, 74, 58]);
    expect(productColours(pixels, SIZE)).toEqual(["#2F4A3A"]);
  });
});
