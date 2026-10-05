import { z } from "zod";

// Maker pricing — types + schemas. Lives in the APP (proprietary moat), never in
// @kiln/engine. The geometry-from-svg -> machine-time derivation is the defensible
// core; see docs/app-idea/PRICING.md.

// The three laser operations. Cut/score are length-driven; engrave is area-driven.
export const Operation = z.enum(["cut", "score", "engrave"]);
export type Operation = z.infer<typeof Operation>;

// Auto-derived from the .svg. Scale-independent (px) so the physical size can
// change without re-parsing. Length in px; area expressed as a 0..1 fill fraction.
export const SvgGeometry = z.object({
  viewport: z.object({
    wPx: z.number().nonnegative(),
    hPx: z.number().nonnegative(),
  }),
  bboxPx: z.object({
    wPx: z.number().nonnegative(),
    hPx: z.number().nonnegative(),
  }),
  totalLengthPx: z.number().nonnegative(),
  // Per-color path length. Kiln's SVGs are usually single-color (one layer).
  layers: z.array(
    z.object({ color: z.string(), lengthPx: z.number().nonnegative() }),
  ),
  // Estimated engrave coverage (ink area / bbox area), 0..1. The user refines it.
  fillFractionEstimate: z.number().min(0).max(1),
  pathCount: z.number().int().nonnegative(),
});
export type SvgGeometry = z.infer<typeof SvgGeometry>;

// A machine preset: speeds + power draw + wear. Speeds are strictly positive so
// time = length/speed and area/rate can never divide by zero.
export const Machine = z.object({
  name: z.string(),
  cutSpeedMmS: z.number().positive(),
  scoreSpeedMmS: z.number().positive(),
  engraveRateMm2S: z.number().positive(),
  drawKw: z.number().nonnegative(),
  wearPerHr: z.number().nonnegative(),
});
export type Machine = z.infer<typeof Machine>;

// A material preset: sheet dimensions + cost + kerf (the gap the beam burns away).
export const Material = z.object({
  name: z.string(),
  sheetWmm: z.number().positive(),
  sheetHmm: z.number().positive(),
  sheetCost: z.number().nonnegative(),
  kerfMm: z.number().nonnegative(),
});
export type Material = z.infer<typeof Material>;

// Shop-wide settings (set once; persisted profiles are Phase 2).
export const ShopProfile = z.object({
  laborRatePerHr: z.number().nonnegative(),
  electricityRateKwh: z.number().nonnegative(),
  markup: z.number().positive(),
  wastePct: z.number().min(0), // fraction, e.g. 0.15 = +15%
  setupFee: z.number().nonnegative(),
  minimumPrice: z.number().nonnegative(),
  handlingMin: z.number().nonnegative(),
});
export type ShopProfile = z.infer<typeof ShopProfile>;

// The maker's saved defaults (persisted as a singleton). Machine/material are
// stored by preset name so the catalog can evolve; shop is the calibrated rates.
export const MakerProfileData = z.object({
  machineName: z.string(),
  materialName: z.string(),
  shop: ShopProfile,
});
export type MakerProfileData = z.infer<typeof MakerProfileData>;

// Per-job inputs the maker sets in the panel.
export const PricingJob = z.object({
  longestSideMm: z.number().positive(),
  quantity: z.number().int().positive(),
  finishingMin: z.number().nonnegative(),
  fillFraction: z.number().min(0).max(1), // engrave coverage (default from geometry)
  assignment: z.record(z.string(), Operation), // color -> operation
});
export type PricingJob = z.infer<typeof PricingJob>;

// Computed output — a plain type (pure, in-process; not a trust boundary).
export interface TierPrice {
  qty: number;
  setup: number;
  unitCost: number;
  unitPrice: number;
  margin: number;
}

export interface PriceBreakdown {
  scaleMmPerPx: number;
  footprint: { wMm: number; hMm: number };
  operations: {
    cut: { lengthMm: number; timeSec: number };
    score: { lengthMm: number; timeSec: number };
    engrave: { areaMm2: number; timeSec: number };
  };
  machineTimeSec: number;
  costs: {
    material: number;
    electricity: number;
    machineWear: number;
    labor: number;
    setup: number;
  };
  piecesPerSheet: number; // 0 when the part doesn't fit on a single sheet
  fitsOnSheet: boolean;
  sheetsPerUnit: number; // <1 when many nest per sheet; >=1 when it spans sheets
  unitCost: number;
  unitPrice: number;
  margin: number;
  tiers: TierPrice[];
}
