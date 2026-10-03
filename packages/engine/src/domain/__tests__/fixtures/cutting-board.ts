import { Product } from "@/domain/product";

// A generic, fictional product (an engraved family cutting board). Engine tests
// use it instead of any real maker's catalog.
export const CUTTING_BOARD = Product.parse({
  id: "pkg:CB-01",
  sku: "CB-01",
  name: "Engraved family cutting board",
  family: "Kitchen",
  dimensions: { w: 16, h: 10, d: 0.75, unit: "in" },
  shape: "rounded rectangle board",
  material: "solid hardwood",
  treatment: "engraved",
  colours: [
    { key: "maple", name: "Maple", face: "#E8D2A6", inlay: "#3B2A1E" },
    { key: "walnut", name: "Walnut", face: "#5B3A29", inlay: "#F2E6D0" },
    { key: "cherry", name: "Cherry", face: "#9A4A2F", inStock: false },
  ],
  defaultColour: "maple",
  typography: { family: "Fraunces", weight: 600, case: "title" },
  wording: [
    { label: "Family name", maxChars: 14, example: "The Riveras" },
    { label: "Year", maxChars: 4, required: false, example: "2026" },
  ],
  source: { kind: "catalog", adapterId: "pkg", ref: "CB-01" },
});
