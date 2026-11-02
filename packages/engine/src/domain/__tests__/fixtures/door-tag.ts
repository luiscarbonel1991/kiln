import { Product } from "@/domain/product";

// A generic, fictional vector product in two colours and two designs (an
// engraved door tag): the face, its edge and its marks paint exactly the
// colour's hexes, and a strip in a fixed colour paints none of them.
export const doorTagSvg = (face: string, edge: string, inlay: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="94" rx="12" fill="${face}" stroke="${edge}" stroke-width="2"/><path d="M40 30h80v34H40z" style="fill:${inlay}"/><rect y="94" width="300" height="6" fill="#3A3634"/></svg>`;

export const dataSvg = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export const DOOR_TAG = Product.parse({
  id: "pkg:DT-01",
  sku: "DT-01",
  name: "Engraved door tag",
  family: "Door decor",
  dimensions: { w: 3, h: 1, unit: "in" },
  shape: "rounded rectangle tag",
  material: "two-tone laminate",
  treatment: "engraved",
  colours: [
    {
      key: "black-white",
      name: "Black/White",
      face: "#1B1B1B",
      edge: "#EDEDED",
      inlay: "#F7F7F5",
      swatchUrl: "https://storage.test/products/black.jpg",
    },
    {
      key: "gold-black",
      name: "Gold/Black",
      face: "#D3B66F",
      edge: "#1A1918",
      inlay: "#1A1918",
      swatchUrl: "https://storage.test/products/gold.jpg",
    },
  ],
  defaultColour: "black-white",
  typography: { family: "Hanken Grotesk", weight: 600, case: "free" },
  wording: [
    { label: "First line", maxChars: 16, example: "Quiet please" },
    { label: "Second line", maxChars: 20, example: "baby sleeping" },
  ],
  styleName: "Quiet please",
  styles: [
    {
      key: "do-not-disturb",
      name: "Do not disturb",
      svgUrl: dataSvg(doorTagSvg("#1B1B1B", "#EDEDED", "#F7F7F5")),
      outlineBox: { x: 0, y: 0, w: 1, h: 0.94 },
      examples: ["Do not disturb"],
    },
  ],
  source: {
    kind: "vector",
    svgUrl: dataSvg(doorTagSvg("#1B1B1B", "#EDEDED", "#F7F7F5")),
    scalePxPerUnit: 100,
    outlineBox: { x: 0, y: 0, w: 1, h: 1 },
  },
});
