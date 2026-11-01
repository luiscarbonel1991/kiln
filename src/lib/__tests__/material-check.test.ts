import { describe, expect, it } from "vitest";
import {
  colourDifference,
  matchGains,
  rgbOf,
  SAME_COLOUR,
  whiteGains,
} from "@/lib/material-check";

const applied = (rgb: number[], gains: number[]) =>
  rgb.map((v, i) => v * gains[i]);

describe("whiteGains", () => {
  it("makes a warm white spot neutral at its own brightness", () => {
    const spot: [number, number, number] = [236, 214, 180];
    const result = whiteGains(spot);
    if (!("gains" in result)) throw new Error(result.refused);
    const [r, g, b] = applied(spot, result.gains);
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
    expect((r + g + b) / 3).toBeCloseTo((236 + 214 + 180) / 3, 6);
  });

  it("refuses a dark, a blown out or a coloured spot", () => {
    expect(whiteGains([30, 28, 25])).toEqual({
      refused: expect.stringContaining("too dark"),
    });
    expect(whiteGains([255, 250, 240])).toEqual({
      refused: expect.stringContaining("blown out"),
    });
    expect(whiteGains([190, 120, 60])).toEqual({
      refused: expect.stringContaining("has colour"),
    });
  });
});

describe("matchGains", () => {
  it("brings the photo's colour to the swatch", () => {
    const result = matchGains("#BE956A", "#EDCFA3");
    if (!("gains" in result)) throw new Error(result.refused);
    const [r, g, b] = applied(rgbOf("#BE956A"), result.gains);
    expect([r, g, b].map(Math.round)).toEqual(rgbOf("#EDCFA3"));
  });

  it("refuses a photo too far from the swatch", () => {
    expect(matchGains("#202020", "#F0F0F0")).toEqual({
      refused: expect.stringContaining("too far"),
    });
    expect(matchGains("#F05000", "#80A0C0")).toEqual({
      refused: expect.stringContaining("too far"),
    });
  });
});

describe("colourDifference", () => {
  it("reads the same colour as zero and near shades under the threshold", () => {
    expect(colourDifference("#EDCFA3", "#EDCFA3")).toBe(0);
    expect(colourDifference("#EDCFA3", "#EBCDA2")).toBeLessThan(SAME_COLOUR);
  });

  it("reads a darker, warmer photo of maple as different", () => {
    expect(colourDifference("#BE956A", "#EDCFA3")).toBeGreaterThan(
      SAME_COLOUR * 3,
    );
    expect(colourDifference("#000000", "#FFFFFF")).toBeCloseTo(100, 0);
  });
});
