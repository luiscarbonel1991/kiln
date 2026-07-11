import { describe, expect, it } from "vitest";
import { estimatePrice } from "@/lib/pricing/estimate";
import {
  DEFAULT_SHOP,
  MACHINE_PRESETS,
  MATERIAL_PRESETS,
} from "@/lib/pricing/presets";
import type { PricingJob, SvgGeometry } from "@/lib/pricing/types";

const machine = MACHINE_PRESETS[0]; // CO2 40W: cut 15, score 80, engrave 14 mm2/s
const material = MATERIAL_PRESETS[1]; // Birch ply 3mm: 600x400, $6, kerf 0.2
const shop = DEFAULT_SHOP; // markup 3, labor 18/hr, setup 5, min 5, waste 0.15, handling 4

// A single black layer, 1000px of path, on a 100px viewport with an 80x80 bbox.
function geo(over: Partial<SvgGeometry> = {}): SvgGeometry {
  return {
    viewport: { wPx: 100, hPx: 100 },
    bboxPx: { wPx: 80, hPx: 80 },
    totalLengthPx: 1000,
    layers: [{ color: "#000000", lengthPx: 1000 }],
    fillFractionEstimate: 0.2,
    pathCount: 1,
    ...over,
  };
}

function job(over: Partial<PricingJob> = {}): PricingJob {
  return {
    longestSideMm: 80, // bbox 80px @ 80mm -> scale 1 mm/px (bbox-anchored)
    quantity: 1,
    finishingMin: 0,
    fillFraction: 0,
    assignment: { "#000000": "cut" },
    ...over,
  };
}

describe("estimatePrice", () => {
  it("derives cut time from length and scale (1000px @ 80mm bbox -> 1000mm / 15mm/s)", () => {
    const r = estimatePrice(geo(), machine, material, shop, job());
    expect(r.operations.cut.lengthMm).toBeCloseTo(1000, 3);
    expect(r.operations.cut.timeSec).toBeCloseTo(1000 / 15, 2);
    expect(r.operations.engrave.areaMm2).toBe(0); // no engrave layer
    expect(r.operations.engrave.timeSec).toBe(0);
  });

  it("anchors scale to the artwork bbox, not the padded viewport", () => {
    // viewBox 2x the artwork: a viewport-anchored scale would price a half-size part.
    const padded = geo({
      viewport: { wPx: 200, hPx: 200 },
      bboxPx: { wPx: 80, hPx: 80 },
    });
    const r = estimatePrice(padded, machine, material, shop, job());
    expect(r.scaleMmPerPx).toBeCloseTo(1, 6); // 80mm / 80px bbox, ignoring the 200px canvas
    expect(r.footprint.wMm).toBeCloseTo(80, 6);
    expect(r.operations.cut.lengthMm).toBeCloseTo(1000, 3);
  });

  it("matches the hand-computed unit cost and price", () => {
    const r = estimatePrice(geo(), machine, material, shop, job());
    // material: 28 pieces/sheet -> (6/28)*1.15 ~= 0.246; +elec+wear+labor 1.2 +setup 5
    expect(r.piecesPerSheet).toBe(28);
    expect(r.unitCost).toBeCloseTo(6.49, 1);
    expect(r.unitPrice).toBeCloseTo(19.46, 1);
    expect(r.margin).toBeCloseTo(r.unitPrice - r.unitCost, 6);
  });

  it("scales length linearly with physical size", () => {
    const small = estimatePrice(
      geo(),
      machine,
      material,
      shop,
      job({ longestSideMm: 100 }),
    );
    const big = estimatePrice(
      geo(),
      machine,
      material,
      shop,
      job({ longestSideMm: 200 }),
    );
    expect(big.operations.cut.lengthMm).toBeCloseTo(
      small.operations.cut.lengthMm * 2,
      3,
    );
    expect(big.operations.cut.timeSec).toBeCloseTo(
      small.operations.cut.timeSec * 2,
      3,
    );
  });

  it("engrave is area-driven and can dwarf a cut layer", () => {
    // Two layers: cut the outline (1000px), engrave a filled region (30% coverage).
    const g = geo({
      layers: [
        { color: "#000000", lengthPx: 1000 },
        { color: "#ff0000", lengthPx: 200 },
      ],
    });
    const r = estimatePrice(
      g,
      machine,
      material,
      shop,
      job({
        fillFraction: 0.3,
        assignment: { "#000000": "cut", "#ff0000": "engrave" },
      }),
    );
    // engrave area = 0.3 * (80*80) = 1920 mm2 -> 1920/14 ~= 137s; cut = 1000/15 ~= 67s
    expect(r.operations.engrave.areaMm2).toBeCloseTo(1920, 1);
    expect(r.operations.engrave.timeSec).toBeGreaterThan(
      r.operations.cut.timeSec,
    );
    // the engrave layer's length must NOT be added to the cut length
    expect(r.operations.cut.lengthMm).toBeCloseTo(1000, 3);
  });

  it("floors the price at the shop minimum for tiny jobs", () => {
    const r = estimatePrice(
      geo({
        layers: [{ color: "#000000", lengthPx: 20 }],
        bboxPx: { wPx: 8, hPx: 8 },
      }),
      machine,
      material,
      shop,
      job({ longestSideMm: 8, quantity: 100 }),
    );
    expect(r.unitPrice).toBe(shop.minimumPrice);
  });

  it("amortizes setup over quantity — tiers are non-increasing", () => {
    const r = estimatePrice(geo(), machine, material, shop, job());
    for (let i = 0; i < r.tiers.length - 1; i++) {
      expect(r.tiers[i].unitPrice).toBeGreaterThanOrEqual(
        r.tiers[i + 1].unitPrice,
      );
    }
    expect(r.tiers[0].qty).toBe(1);
    expect(r.tiers.at(-1)?.qty).toBe(100);
  });

  it("stays finite on empty geometry (no paths, zero viewport)", () => {
    const empty: SvgGeometry = {
      viewport: { wPx: 0, hPx: 0 },
      bboxPx: { wPx: 0, hPx: 0 },
      totalLengthPx: 0,
      layers: [],
      fillFractionEstimate: 0,
      pathCount: 0,
    };
    const r = estimatePrice(
      empty,
      machine,
      material,
      shop,
      job({ assignment: {} }),
    );
    expect(r.machineTimeSec).toBe(0);
    expect(Number.isFinite(r.unitCost)).toBe(true);
    expect(Number.isFinite(r.unitPrice)).toBe(true);
    expect(r.unitPrice).toBeGreaterThan(0);
  });

  it("flags a part larger than the sheet and bills across N sheets", () => {
    // 80px bbox @ 1200mm -> a 1200x1200mm part; Birch ply sheet is 600x400.
    const r = estimatePrice(
      geo(),
      machine,
      material,
      shop,
      job({ longestSideMm: 1200 }),
    );
    expect(r.fitsOnSheet).toBe(false);
    expect(r.piecesPerSheet).toBe(0);
    // 1200*1200 / (600*400) = 6 sheets, each $6 + 15% waste
    expect(r.sheetsPerUnit).toBe(6);
    expect(r.costs.material).toBeCloseTo(6 * 6 * 1.15, 2);
    expect(r.costs.material).toBeGreaterThan(material.sheetCost);
  });

  it("bounds pieces-per-sheet for a degenerate (line) footprint", () => {
    // A pure horizontal line: bbox height 0. The MIN_PIECE_MM floor must stop the
    // collapsed axis from packing thousands of phantom pieces.
    const line = geo({
      bboxPx: { wPx: 100, hPx: 0 },
      layers: [{ color: "#000000", lengthPx: 100 }],
    });
    const r = estimatePrice(
      line,
      machine,
      material,
      shop,
      job({ longestSideMm: 100 }),
    );
    expect(r.fitsOnSheet).toBe(true);
    expect(r.piecesPerSheet).toBeLessThan(1000); // not the ~2000 from a kerf-only pitch
    expect(Number.isFinite(r.costs.material)).toBe(true);
    expect(r.operations.engrave.areaMm2).toBe(0); // a line has no engrave area
  });
});
