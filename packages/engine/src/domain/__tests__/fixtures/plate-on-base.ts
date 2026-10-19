import { Product } from "@/domain/product";
import { CUTTING_BOARD } from "./cutting-board";

// A generic, fictional two-part product: a name plate standing upright in a
// base lying flat, the base always black matte.
export const PLATE_ON_BASE = Product.parse({
  ...CUTTING_BOARD,
  id: "pkg:PB-01",
  sku: "PB-01",
  name: "Name plate on a base",
  dimensions: { w: 9, h: 2.78, d: 2.25, unit: "in" },
  shape: "name plate",
  material: "hardwood",
  parts: [
    { name: "plate", dimensions: { w: 8, h: 2.5, d: 0.14 } },
    {
      name: "base",
      lies: "flat",
      dimensions: { w: 9, h: 0.25, d: 2.25 },
      material: "two layers of the same sheet",
      colour: { name: "black matte", hex: "#1A1A1A" },
    },
  ],
});
