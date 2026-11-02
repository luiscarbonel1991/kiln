import { describe, expect, it } from "vitest";
import { DOOR_TAG, doorTagSvg } from "@/domain/__tests__/fixtures/door-tag";
import { colourOf, Product } from "@/domain/product";
import { drawnIn, paintColours, recolourSvg } from "@/domain/recolour";

const BLACK = doorTagSvg("#1B1B1B", "#EDEDED", "#F7F7F5");

describe("paintColours", () => {
  it("reads paints in attributes and style declarations, in six or three digits", () => {
    expect([...paintColours(BLACK)].sort()).toEqual([
      "#1B1B1B",
      "#3A3634",
      "#EDEDED",
      "#F7F7F5",
    ]);
    expect([
      ...paintColours(
        '<svg><stop stop-color="#abc"/><g style="stroke: #102030"/></svg>',
      ),
    ]).toEqual(["#AABBCC", "#102030"]);
  });
});

describe("drawnIn", () => {
  it("finds the colour the drawing paints, the default first", () => {
    expect(drawnIn(BLACK, DOOR_TAG)?.key).toBe("black-white");
    const gold = doorTagSvg("#d3b66f", "#1A1918", "#1A1918");
    expect(drawnIn(gold, DOOR_TAG)?.key).toBe("gold-black");
    expect(drawnIn(doorTagSvg("#123456", "#000", "#fff"), DOOR_TAG)).toBeNull();
  });
});

describe("recolourSvg", () => {
  it("redraws the face, its edge and its marks in another colour, and leaves other paints alone", () => {
    const gold = recolourSvg(
      BLACK,
      colourOf(DOOR_TAG, "black-white"),
      colourOf(DOOR_TAG, "gold-black"),
    );
    expect(gold).toContain('fill="#D3B66F"');
    expect(gold).toContain('stroke="#1A1918"');
    expect(gold).toContain("fill:#1A1918");
    expect(gold).toContain('fill="#3A3634"');
    expect(paintColours(gold).has("#1B1B1B")).toBe(false);
  });

  it("swaps two colours that trade hexes once, not twice", () => {
    const tag = Product.parse({
      ...DOOR_TAG,
      colours: [
        {
          key: "charcoal",
          name: "Charcoal",
          face: "#171311",
          inlay: "#FEFEFD",
        },
        { key: "oat", name: "Oat", face: "#ECD6C4", inlay: "#171311" },
      ],
      defaultColour: "charcoal",
    });
    const oat = recolourSvg(
      doorTagSvg("#171311", "#000000", "#FEFEFD"),
      colourOf(tag, "charcoal"),
      colourOf(tag, "oat"),
    );
    expect(oat).toContain(
      '<rect width="300" height="94" rx="12" fill="#ECD6C4"',
    );
    expect(oat).toContain("fill:#171311");
    expect(oat).toContain('stroke="#000000"');
  });
});
