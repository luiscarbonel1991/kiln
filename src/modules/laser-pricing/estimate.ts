import type {
  Machine,
  Material,
  PriceBreakdown,
  PricingJob,
  ShopProfile,
  SvgGeometry,
} from "@/modules/laser-pricing/types";

// The cost model — pure and deterministic (the moat logic; unit-tested against the
// real-SVG proof). See docs/app-idea/PRICING.md for the derivation.
//
//   machine time = cut_len/v_cut + score_len/v_score + engrave_area/v_engrave
//
// Cut/score are length-driven; engrave is AREA-driven (a length-only model
// underestimates an engraved piece by ~4-5x).

// A part's collapsed or sub-millimetre axis must not pack thousands of "pieces"
// onto a sheet; floor every piece pitch at a realistic minimum.
const MIN_PIECE_MM = 5;

export function estimatePrice(
  geometry: SvgGeometry,
  machine: Machine,
  material: Material,
  shop: ShopProfile,
  job: PricingJob,
): PriceBreakdown {
  // px -> mm, anchored to the ARTWORK (bbox), not the SVG canvas: the maker's
  // "longest side" is the size of the part, and generated cut files carry padding.
  // Guard the empty-geometry case so nothing becomes NaN/Infinity.
  const maxBbox = Math.max(geometry.bboxPx.wPx, geometry.bboxPx.hPx);
  const scale = maxBbox > 0 ? job.longestSideMm / maxBbox : 0;

  const bboxWmm = geometry.bboxPx.wPx * scale;
  const bboxHmm = geometry.bboxPx.hPx * scale;
  const footprintMm2 = bboxWmm * bboxHmm;

  // Sum length per length-driven operation from the layer assignment.
  let cutLenMm = 0;
  let scoreLenMm = 0;
  for (const layer of geometry.layers) {
    const op = job.assignment[layer.color] ?? "cut";
    const lenMm = layer.lengthPx * scale;
    if (op === "cut") cutLenMm += lenMm;
    else if (op === "score") scoreLenMm += lenMm;
    // engrave: the layer's outline length is negligible; its AREA drives the time
  }
  const anyEngrave = Object.values(job.assignment).some(
    (op) => op === "engrave",
  );
  const engraveAreaMm2 = anyEngrave ? job.fillFraction * footprintMm2 : 0;

  const cutSec = cutLenMm / machine.cutSpeedMmS;
  const scoreSec = scoreLenMm / machine.scoreSpeedMmS;
  const engraveSec = engraveAreaMm2 / machine.engraveRateMm2S;
  const machineTimeSec = cutSec + scoreSec + engraveSec;
  const machineTimeH = machineTimeSec / 3600;

  // Material: nest the part (bbox + kerf gap, floored at MIN_PIECE_MM) on a sheet.
  // If it doesn't fit in either axis, bill by area across the sheets it spans and
  // flag it so the UI can warn instead of silently pricing a single sheet.
  const pieceWmm = Math.max(bboxWmm + material.kerfMm, MIN_PIECE_MM);
  const pieceHmm = Math.max(bboxHmm + material.kerfMm, MIN_PIECE_MM);
  const fitsOnSheet =
    pieceWmm <= material.sheetWmm && pieceHmm <= material.sheetHmm;
  let piecesPerSheet = 0;
  let sheetsPerUnit: number;
  let materialUnit: number;
  if (fitsOnSheet) {
    piecesPerSheet = Math.max(
      1,
      Math.floor(material.sheetWmm / pieceWmm) *
        Math.floor(material.sheetHmm / pieceHmm),
    );
    sheetsPerUnit = 1 / piecesPerSheet;
    materialUnit = (material.sheetCost / piecesPerSheet) * (1 + shop.wastePct);
  } else {
    const sheetArea = material.sheetWmm * material.sheetHmm;
    sheetsPerUnit = Math.max(1, Math.ceil(footprintMm2 / sheetArea));
    materialUnit = material.sheetCost * sheetsPerUnit * (1 + shop.wastePct);
  }

  // Per-unit costs that don't depend on quantity.
  const electricity = machine.drawKw * machineTimeH * shop.electricityRateKwh;
  const machineWear = machine.wearPerHr * machineTimeH;
  const labor =
    ((shop.handlingMin + job.finishingMin) / 60) * shop.laborRatePerHr;

  // Setup amortizes over the batch, so price is a function of quantity.
  const priceAt = (qty: number) => {
    const setup = shop.setupFee / Math.max(qty, 1);
    const unitCost = materialUnit + electricity + machineWear + labor + setup;
    const unitPrice = Math.max(unitCost * shop.markup, shop.minimumPrice);
    return { qty, setup, unitCost, unitPrice, margin: unitPrice - unitCost };
  };

  const current = priceAt(job.quantity);
  const tiers = [1, 10, 25, 50, 100].map(priceAt);

  return {
    scaleMmPerPx: scale,
    footprint: { wMm: bboxWmm, hMm: bboxHmm },
    operations: {
      cut: { lengthMm: cutLenMm, timeSec: cutSec },
      score: { lengthMm: scoreLenMm, timeSec: scoreSec },
      engrave: { areaMm2: engraveAreaMm2, timeSec: engraveSec },
    },
    machineTimeSec,
    costs: {
      material: materialUnit,
      electricity,
      machineWear,
      labor,
      setup: current.setup,
    },
    piecesPerSheet,
    fitsOnSheet,
    sheetsPerUnit,
    unitCost: current.unitCost,
    unitPrice: current.unitPrice,
    margin: current.margin,
    tiers,
  };
}
