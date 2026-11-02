import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardColours } from "@/components/projects/board-colours";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { Product } from "@/domain/product";

const layered = Product.parse({
  ...CUTTING_BOARD,
  treatment: "reveal",
  colours: [
    {
      key: "walnut",
      name: "Walnut",
      face: "#5B3A29",
      inlay: "#FFFFFF",
      swatchUrl: "https://storage.test/products/walnut.jpg",
    },
    {
      key: "black",
      name: "Black",
      face: "#1F1F1F",
      inlay: "#FFFFFF",
      supplierUrl: "https://supplier.example/black",
    },
    {
      key: "red",
      name: "Red",
      face: "#B0302A",
      inlay: "#FFFFFF",
      supplierUrl: "javascript:alert(1)",
    },
  ],
  defaultColour: "walnut",
});

const markup = (product: Product, scenes?: string) =>
  renderToStaticMarkup(createElement(BoardColours, { product, scenes }));

describe("the colours beside the reference", () => {
  it("shows each colour's sample, face and base, and supplier page", () => {
    const html = markup(layered);
    expect(html).toContain('src="https://storage.test/products/walnut.jpg"');
    expect(html.match(/face · cut shows/g)).toHaveLength(3);
    expect(html).toContain('href="https://supplier.example/black"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Walnut</span> · scenes use this");
  });

  it("flags only a colour with neither a photo nor a supplier page, and never draws a script link", () => {
    const html = markup(layered);
    expect(html.match(/unverified look/g)).toHaveLength(1);
    expect(html).not.toContain("javascript:");
    const red = html.slice(html.indexOf('data-testid="board-colour-red"'));
    expect(red).toContain("unverified look");
  });

  it("names the project's colour as the one scenes use, not the product's default", () => {
    const html = markup(layered, "black");
    expect(html).toContain("Black</span> · scenes use this");
    expect(html).not.toContain("Walnut</span> · scenes use this");
  });

  it("shows a colour's hex when it is not layered", () => {
    const html = markup(Product.parse({ ...layered, treatment: "engraved" }));
    expect(html).not.toContain("cut shows");
    expect(html).toContain("#5B3A29");
  });
});
