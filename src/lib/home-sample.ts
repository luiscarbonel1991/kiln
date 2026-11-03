import { Product } from "@/domain/product";

// The sample product Home tells its story with when the maker has nothing of
// their own yet (or a chapter has nothing to show): generic, a maker of
// kitchenware anywhere could sell it. It is drawn and written by Kiln for
// free, like any product; nothing about it is paid or sent.

export const SAMPLE_PRODUCT: Product = Product.parse({
  id: "sample:board",
  sku: "SAMPLE-01",
  name: "Engraved family cutting board",
  family: "Kitchen",
  description: "Solid hardwood board with the family name engraved.",
  dimensions: { w: 16, h: 10, d: 0.75, unit: "in" },
  shape: "rounded rectangle board",
  material: "solid hardwood",
  treatment: "engraved",
  colours: [
    { key: "maple", name: "Maple", face: "#E8D2A6", inlay: "#3B2A1E" },
    { key: "walnut", name: "Walnut", face: "#5B3A29", inlay: "#F2E6D0" },
    { key: "cherry", name: "Cherry", face: "#9A4A2F", inlay: "#F2E6D0" },
  ],
  defaultColour: "maple",
  typography: { family: "Fraunces", weight: 600, case: "title" },
  wording: [
    {
      label: "Family name",
      maxChars: 14,
      required: true,
      example: "The Riveras",
    },
    { label: "Year", maxChars: 4, required: false, example: "2026" },
  ],
  useContexts: [
    "a kitchen counter during dinner prep",
    "a set dinner table, serving cheese and bread",
  ],
  hook: "Your family name, carved to last",
  price: 48,
  source: { kind: "form" },
});

// The sample design: a leaf drawn as line art, its paths as the vector.
export const SAMPLE_DESIGN = {
  name: "Leaf",
  // Each stroke of the line art, in a 100 x 100 box.
  paths: [
    "M50 12 C72 28 78 58 50 88 C22 58 28 28 50 12 Z",
    "M50 22 L50 84",
    "M50 40 L63 30",
    "M50 54 L37 44",
    "M50 66 L63 56",
    "M50 76 L40 70",
  ],
  // The source drawing's colours: the leaf, its veins, the paper.
  leaf: "#5E7B4F",
  vein: "#E9E1D2",
  paper: "#F4ECDD",
} as const;
