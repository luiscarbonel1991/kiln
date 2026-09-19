import { describe, expect, it } from "vitest";
import { PlateRequest } from "@/domain/product";
import { composePlateSvg, rasterize, svgBox } from "@/providers/plates/svg";

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
