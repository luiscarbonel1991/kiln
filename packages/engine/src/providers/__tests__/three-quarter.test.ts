import { Resvg } from "@resvg/resvg-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { Product } from "@/domain/product";

const fetchAsset = vi.fn();
const storeAsset = vi.fn(async () => "https://stub.local/plates/above.png");
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: (...a: unknown[]) => fetchAsset(...a),
  storeAsset: (...a: unknown[]) => storeAsset(...(a as [])),
}));

const { renderThreeQuarter, standingLayout, threeQuarterPlateSvg } =
  await import("@/providers/plates/three-quarter");

// A plate on a stand, drawn as its front: the upright part's face on top, the
// flat part's front as a band along the bottom (red here, so a leak shows).
const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 278" width="9in" height="2.78in"><rect x="50" y="0" width="800" height="250" rx="28" fill="#CBA983"/><rect x="0" y="250" width="900" height="28" fill="#FF0000"/></svg>`;
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(DRAWING).toString("base64")}`;

const stand = (parts?: unknown[], over: object = {}) =>
  Product.parse({
    ...CUTTING_BOARD,
    id: "pkg:ST-01",
    sku: "ST-01",
    name: "Name plate on a stand",
    dimensions: { w: 9, h: 2.78, d: 2.25, unit: "in" },
    colours: [{ key: "oak", name: "Oak", face: "#CBA983", edge: "#45301F" }],
    defaultColour: "oak",
    parts: parts ?? [
      { name: "plate", dimensions: { w: 8, h: 2.5, d: 0.14 } },
      {
        name: "stand",
        lies: "flat",
        dimensions: { w: 9, h: 0.28, d: 2.25 },
        corner: 1.125,
      },
    ],
    source: { kind: "vector", svgUrl },
    ...over,
  });

const STAND = stand();

describe("standingLayout", () => {
  it("takes the main part upright on the part lying flat", () => {
    const layout = standingLayout(STAND);
    expect("refusal" in layout ? null : layout.flat.name).toBe("stand");
  });

  it("refuses parts that do not stand so", () => {
    const [plate, base] = STAND.parts ?? [];
    const refused = (parts: unknown[]) => standingLayout(stand(parts));
    expect(refused([plate, base, { ...base, name: "foot" }])).toHaveProperty(
      "refusal",
    );
    expect(
      refused([
        { ...plate, lies: "flat" },
        { ...base, lies: "upright" },
      ]),
    ).toHaveProperty("refusal");
    expect(
      refused([plate, { ...base, dimensions: { ...base.dimensions, h: 0.6 } }]),
    ).toHaveProperty("refusal");
    expect(
      refused([plate, { ...base, dimensions: { ...base.dimensions, w: 10 } }]),
    ).toHaveProperty("refusal");
    expect(
      refused([
        plate,
        { ...base, corner: undefined, dimensions: { w: 9, h: 0.28, d: 0.1 } },
      ]),
    ).toHaveProperty("refusal");
  });
});

describe("threeQuarterPlateSvg", () => {
  it("sizes each part from above at 30 degrees, fitted like the plate", () => {
    const out = threeQuarterPlateSvg(DRAWING, STAND);
    if (!out) throw new Error("refused");
    const g = out.geometry;
    const s = (1024 * 0.86) / 9;
    expect(g.scale).toBeCloseTo(s, 3);
    expect(g.face.h).toBeCloseTo(2.5 * Math.cos(Math.PI / 6) * s, 3);
    expect(g.top.h).toBeCloseTo(2.25 * 0.5 * s, 3);
    expect(g.top.ry).toBeCloseTo(g.top.h / 2, 3);
    expect(g.top.rx).toBeCloseTo(1.125 * s, 3);
    expect(g.wall).toBeCloseTo(0.28 * Math.cos(Math.PI / 6) * s, 3);
    expect(g.rim).toBeCloseTo(0.14 * 0.5 * s, 3);
    // The flat part's top in front of the upright part: (d_flat - d_upright)/2.
    expect(g.top.y + g.top.h - (g.face.y + g.face.h)).toBeCloseTo(
      ((2.25 - 0.14) / 2) * 0.5 * s,
      3,
    );
    expect(g.bounds.x).toBeCloseTo((1024 - g.bounds.w) / 2, 3);
    expect(g.bounds.y).toBeCloseTo((1024 - g.bounds.h) / 2, 3);
    expect(g.band).toEqual({ x: 0, y: 0, w: 900, h: 250 });
  });

  it("a shallower angle shows less of the top", () => {
    const out = threeQuarterPlateSvg(DRAWING, STAND, { angleDeg: 25 });
    if (!out) throw new Error("refused");
    const g = out.geometry;
    const rad = (25 * Math.PI) / 180;
    expect(g.face.h).toBeCloseTo(2.5 * Math.cos(rad) * g.scale, 3);
    expect(g.top.h).toBeCloseTo(2.25 * Math.sin(rad) * g.scale, 3);
  });

  it("paints each part where it belongs, the band never under the face", () => {
    const out = threeQuarterPlateSvg(DRAWING, STAND);
    if (!out) throw new Error("refused");
    const { face, top, wall, rim } = out.geometry;
    const image = new Resvg(out.doc).render();
    const at = (x: number, y: number) => {
      const i = (Math.round(y) * image.width + Math.round(x)) * 4;
      return `#${[...image.pixels.subarray(i, i + 3)]
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")}`.toUpperCase();
    };
    const mid = face.x + face.w / 2;
    expect(image.width).toBe(1024);
    expect(at(mid, face.y + face.h + 4)).toBe("#CBA983");
    expect(at(mid, top.y + top.h + wall / 2)).toBe("#45301F");
    expect(at(mid, face.y + face.h / 2)).toBe("#CBA983");
    expect(at(mid, face.y - rim / 2)).toBe("#45301F");
    expect(at(20, 20)).toBe("#F0EEE9");
  });

  it("refuses a drawing that does not match the product, and odd angles", () => {
    const tall = DRAWING.replace('height="250" rx', 'height="400" rx');
    expect(threeQuarterPlateSvg(tall, STAND)).toBeNull();
    expect(() =>
      threeQuarterPlateSvg(DRAWING, STAND, { angleDeg: 60 }),
    ).toThrow();
  });
});

describe("renderThreeQuarter", () => {
  beforeEach(() => {
    fetchAsset.mockReset();
    storeAsset.mockClear();
  });

  it("stores the view from above by its content", async () => {
    fetchAsset.mockResolvedValue({
      bytes: Buffer.from(DRAWING),
      mime: "image/svg+xml",
    });
    expect(await renderThreeQuarter(STAND)).toEqual({
      assetUrl: "https://stub.local/plates/above.png",
      mime: "image/png",
      angleDeg: 30,
    });
    expect(storeAsset).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "image/png",
      "plates",
      { byContent: true },
    );
  });

  it("fetches nothing for a product it cannot draw so", async () => {
    const photo = stand(undefined, {
      source: { kind: "photo", assetUrl: "https://stub.local/p.png" },
    });
    const [plate] = STAND.parts ?? [];
    const lying = stand([
      { ...plate, lies: "flat" },
      { ...plate, name: "back" },
    ]);
    expect(await renderThreeQuarter(photo)).toBeNull();
    expect(await renderThreeQuarter(lying)).toBeNull();
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});
