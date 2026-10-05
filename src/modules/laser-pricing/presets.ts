import type {
  Machine,
  Material,
  ShopProfile,
} from "@/modules/laser-pricing/types";

// Sensible starting presets. Phase 2 persists per-shop overrides (Prisma); for now
// these are the editable defaults the panel opens with. Speeds/rates are typical
// ballparks — the maker calibrates once for their machine + material.

export const MACHINE_PRESETS: Machine[] = [
  {
    name: "CO2 40W (generic)",
    cutSpeedMmS: 15,
    scoreSpeedMmS: 80,
    engraveRateMm2S: 14,
    drawKw: 0.9,
    wearPerHr: 2,
  },
  {
    name: "CO2 60W",
    cutSpeedMmS: 25,
    scoreSpeedMmS: 110,
    engraveRateMm2S: 22,
    drawKw: 1.4,
    wearPerHr: 2.5,
  },
  {
    name: "Diode 10W",
    cutSpeedMmS: 6,
    scoreSpeedMmS: 45,
    engraveRateMm2S: 8,
    drawKw: 0.2,
    wearPerHr: 0.8,
  },
];

export const MATERIAL_PRESETS: Material[] = [
  { name: "MDF 3mm", sheetWmm: 600, sheetHmm: 400, sheetCost: 4, kerfMm: 0.2 },
  {
    name: "Birch ply 3mm",
    sheetWmm: 600,
    sheetHmm: 400,
    sheetCost: 6,
    kerfMm: 0.2,
  },
  {
    name: "Acrylic 3mm",
    sheetWmm: 600,
    sheetHmm: 400,
    sheetCost: 12,
    kerfMm: 0.3,
  },
  {
    name: "Acrylic 5mm",
    sheetWmm: 600,
    sheetHmm: 400,
    sheetCost: 18,
    kerfMm: 0.35,
  },
];

export const DEFAULT_SHOP: ShopProfile = {
  laborRatePerHr: 18,
  electricityRateKwh: 0.15,
  markup: 3,
  wastePct: 0.15,
  setupFee: 5,
  minimumPrice: 5,
  handlingMin: 4,
};

// Sensible defaults the panel opens with.
export const DEFAULT_JOB = {
  longestSideMm: 80,
  quantity: 1,
  finishingMin: 0,
};
