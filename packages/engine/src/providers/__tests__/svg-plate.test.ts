import { describe, expect, it } from "vitest";
import { PlateRequest } from "@/domain/product";
import {
  composePlateSvg,
  measureOutline,
  rasterize,
  svgBox,
} from "@/providers/plates/svg";

const disc = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250"><circle cx="125" cy="125" r="125" fill="#4B5F50"/><text x="125" y="150" font-size="80" text-anchor="middle" fill="#fff">01</text></svg>`;

describe("svgBox", () => {
  it("reads the viewBox", () => {
    expect(svgBox(disc)).toEqual({ x: 0, y: 0, w: 250, h: 250 });
  });
  it("falls back to px width/height", () => {
    expect(svgBox('<svg width="300px" height="120"></svg>')).toEqual({
      x: 0,
      y: 0,
      w: 300,
      h: 120,
    });
  });
  it("throws without a size", () => {
    expect(() => svgBox("<svg></svg>")).toThrow();
  });
});

describe("measureOutline", () => {
  // A 4 in coaster drawn with a margin: the circle (stroke included) spans
  // 2.5..97.5 of a 100-unit frame.
  const coaster = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#D9B98C" stroke="#5B3A29" stroke-width="3"/></svg>`;

  it("finds the drawing inside its margin, as fractions of the frame", () => {
    const measured = measureOutline(coaster, { w: 4, h: 4 });
    expect("box" in measured && measured.box).toEqual({
      x: 0.025,
      y: 0.025,
      w: 0.95,
      h: 0.95,
    });
  });

  it("works in the frame's own units, whatever its origin or rendered size", () => {
    const offset = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100" width="400" height="200"><rect x="30" y="40" width="100" height="50"/></svg>`;
    const measured = measureOutline(offset, { w: 6, h: 3 });
    expect("box" in measured && measured.box).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.5,
    });
  });

  it("refuses a drawing whose proportions are not the product's", () => {
    const measured = measureOutline(coaster, { w: 5, h: 3 });
    expect("mismatch" in measured && measured.mismatch).toContain(
      "is 1.00:1 but the product is 5 x 3 (1.67:1)",
    );
  });

  it("checks the calibrated width when the drawing has one", () => {
    expect("box" in measureOutline(coaster, { w: 4, h: 4 }, 23.75)).toBe(true);
    const off = measureOutline(coaster, { w: 4, h: 4 }, 10);
    expect("mismatch" in off && off.mismatch).toContain("9.50 wide");
  });

  it("measures what the drawing shows: a grain clipped to its outline, or a guide never seen, is left out", () => {
    // A 5 x 10 board whose grain streaks run 10 units past each side,
    // clipped to the outline (DOGFOOD #59).
    const board = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 540 1000"><defs><clipPath id="o"><rect x="0" y="0" width="500" height="1000"/></clipPath></defs><rect x="0" y="0" width="500" height="1000" fill="#C8A165"/><g clip-path="url(#o)"><rect x="-10" y="100" width="520" height="8" fill="#8A6A40"/><rect x="-10" y="400" width="520" height="8" fill="#8A6A40"/></g></svg>`;
    const measured = measureOutline(board, { w: 5, h: 10 });
    expect("box" in measured).toBe(true);
    if ("box" in measured) {
      expect(measured.box.w).toBeCloseTo(500 / 540, 2);
      expect(measured.box.x).toBeCloseTo(20 / 540, 2);
    }
    const guide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100" fill="none" stroke="none"/><rect x="50" y="25" width="100" height="50" fill="#333"/></svg>`;
    const seen = measureOutline(guide, { w: 2, h: 1 });
    expect("box" in seen && seen.box.w).toBeCloseTo(0.5, 2);
  });

  it("an empty drawing has no outline", () => {
    const empty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`;
    expect(measureOutline(empty, { w: 1, h: 1 })).toEqual({
      mismatch: "its SVG draws nothing",
    });
  });
});

describe("composePlateSvg", () => {
  it("fits one piece to 86 % of the card, centred", () => {
    const req = PlateRequest.parse({
      productId: "p",
      pieces: [{ colour: "sage", wording: ["01"] }],
    });
    const { boxes, scale } = composePlateSvg(disc, svgBox(disc), req);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].w).toBe(Math.round(1024 * 0.86));
    expect(boxes[0].x).toBe(Math.round((1024 - 1024 * 0.86) / 2));
    expect(scale).toBeCloseTo((1024 * 0.86) / 250, 5);
  });

  it("lays five pieces in a row without overflowing", () => {
    const req = PlateRequest.parse({
      productId: "p",
      layout: "row",
      pieces: ["01", "02", "03", "04", "05"].map((t) => ({
        colour: "sage",
        wording: [t],
      })),
    });
    const { boxes, doc } = composePlateSvg(disc, svgBox(disc), req);
    expect(boxes).toHaveLength(5);
    const right = boxes[4].x + boxes[4].w;
    expect(right).toBeLessThanOrEqual(1024);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].w);
    expect(doc.match(/<circle/g)).toHaveLength(5);
    expect(doc).toContain('fill="#F0EEE9"');
  });

  it("stacks pieces vertically", () => {
    const req = PlateRequest.parse({
      productId: "p",
      layout: "stack",
      pieces: [
        { colour: "sage", wording: ["A"] },
        { colour: "sage", wording: ["B"] },
      ],
    });
    const { boxes } = composePlateSvg(disc, svgBox(disc), req);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].h);
    expect(boxes[1].x).toBe(boxes[0].x);
  });
});

describe("rasterize", () => {
  it("produces a square PNG of the requested size", () => {
    const req = PlateRequest.parse({
      productId: "p",
      sizePx: 512,
      pieces: [{ colour: "sage", wording: ["01"] }],
    });
    const { doc } = composePlateSvg(disc, svgBox(disc), req);
    const png = rasterize(doc, 512);
    expect(png.length).toBeGreaterThan(1000);
    // PNG header + IHDR width/height at bytes 16..23
    expect(Buffer.from(png.subarray(0, 8)).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
    const w = Buffer.from(png.subarray(16, 20)).readUInt32BE(0);
    const h = Buffer.from(png.subarray(20, 24)).readUInt32BE(0);
    expect([w, h]).toEqual([512, 512]);
  });
});
