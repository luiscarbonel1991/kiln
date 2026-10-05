import { describe, expect, it } from "vitest";
import { parseSvgGeometry } from "@/modules/laser-pricing/geometry";

describe("parseSvgGeometry", () => {
  it("reads viewport, length, bbox and a full fill for a closed square", () => {
    // 80x80 square inset in a 100x100 viewport; perimeter = 4*80 = 320px.
    const svg =
      '<svg width="100" height="100"><path d="M10 10 H90 V90 H10 Z" stroke="#000" fill="none"/></svg>';
    const g = parseSvgGeometry(svg);
    expect(g.viewport).toEqual({ wPx: 100, hPx: 100 });
    expect(g.layers).toHaveLength(1);
    expect(g.layers[0].color).toBe("#000");
    expect(g.layers[0].lengthPx).toBeCloseTo(320, 0);
    expect(g.totalLengthPx).toBeCloseTo(320, 0);
    expect(g.bboxPx.wPx).toBeCloseTo(80, 0);
    expect(g.bboxPx.hPx).toBeCloseTo(80, 0);
    // a closed square fills its bbox -> fraction clamps to ~1
    expect(g.fillFractionEstimate).toBeGreaterThan(0.9);
    expect(g.pathCount).toBe(1);
  });

  it("reads a viewBox when width/height are absent", () => {
    const svg =
      '<svg viewBox="0 0 200 120"><path d="M0 0 L100 0" stroke="#111"/></svg>';
    const g = parseSvgGeometry(svg);
    expect(g.viewport).toEqual({ wPx: 200, hPx: 120 });
  });

  it("gives ~zero fill for an open (unenclosed) line", () => {
    const svg =
      '<svg width="100" height="100"><path d="M0 50 L100 50" stroke="#000"/></svg>';
    const g = parseSvgGeometry(svg);
    expect(g.layers[0].lengthPx).toBeCloseTo(100, 0);
    expect(g.fillFractionEstimate).toBe(0); // flat line has no bbox area
  });

  it("groups paths by color into separate layers", () => {
    const svg = [
      "<svg width='100' height='100'>",
      "<path d='M0 0 L50 0' stroke='#000'/>",
      "<path d='M0 10 L50 10' stroke='#000'/>",
      "<path d='M0 20 L30 20' stroke='#f00'/>",
      "</svg>",
    ].join("");
    const g = parseSvgGeometry(svg);
    expect(g.layers).toHaveLength(2);
    const black = g.layers.find((l) => l.color === "#000");
    const red = g.layers.find((l) => l.color === "#f00");
    expect(black?.lengthPx).toBeCloseTo(100, 0); // two 50px lines
    expect(red?.lengthPx).toBeCloseTo(30, 0);
  });

  it("skips malformed path data without throwing", () => {
    const svg =
      '<svg width="100" height="100"><path d="not a path" stroke="#000"/><path d="M0 0 L40 0" stroke="#000"/></svg>';
    expect(() => parseSvgGeometry(svg)).not.toThrow();
    const g = parseSvgGeometry(svg);
    expect(g.totalLengthPx).toBeCloseTo(40, 0);
  });

  it("gives zero fill for an OPEN path with 2D extent (score/cut line)", () => {
    // An open L-shape spans a real bbox but encloses nothing — no Z, no fill.
    const svg =
      '<svg width="100" height="100"><path d="M0 0 L100 0 L100 100" stroke="#000"/></svg>';
    const g = parseSvgGeometry(svg);
    expect(g.bboxPx.wPx).toBeCloseTo(100, 0);
    expect(g.bboxPx.hPx).toBeCloseTo(100, 0);
    expect(g.fillFractionEstimate).toBe(0);
  });

  it("subtracts an opposite-wound hole instead of bridging subpaths", () => {
    // 100x100 outer (CW) with a 60x60 inner hole wound the other way.
    const svg =
      '<svg width="100" height="100"><path d="M0 0 L100 0 L100 100 L0 100 Z M20 20 L20 80 L80 80 L80 20 Z" fill="#000"/></svg>';
    const g = parseSvgGeometry(svg);
    // true filled area = 10000 - 3600 = 6400 -> 0.64, not clamped to 1
    expect(g.fillFractionEstimate).toBeGreaterThan(0.55);
    expect(g.fillFractionEstimate).toBeLessThan(0.72);
  });

  it("does not read the viewport from a child's stroke-width", () => {
    // No root width/viewBox: must fall back to the ~300x200 bbox, NOT grab
    // stroke-width="2.5". (bbox is sampled, so allow a small vertex tolerance.)
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L300 0 L300 200 Z" stroke="#000" stroke-width="2.5"/></svg>';
    const g = parseSvgGeometry(svg);
    expect(g.viewport.wPx).toBeGreaterThan(250);
    expect(g.viewport.hPx).toBeGreaterThan(150);
  });

  it("reads a viewBox with comma separators", () => {
    const svg =
      '<svg viewBox="0,0,200,120"><path d="M0 0 L10 0" stroke="#000"/></svg>';
    const g = parseSvgGeometry(svg);
    expect(g.viewport).toEqual({ wPx: 200, hPx: 120 });
  });
});
