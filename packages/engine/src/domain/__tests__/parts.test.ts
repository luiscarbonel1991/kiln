import { describe, expect, it } from "vitest";
import {
  buyerSizeLabel,
  Product,
  partLabel,
  productImages,
} from "@/domain/product";
import { CUTTING_BOARD } from "./fixtures/cutting-board";
import { PLATE_ON_BASE } from "./fixtures/plate-on-base";

describe("parts", () => {
  it("each part's size reads by how it stands", () => {
    const [plate, base] = PLATE_ON_BASE.parts ?? [];
    expect(partLabel(plate, "in")).toBe("8 x 2.5 in, 0.14 in thick");
    expect(partLabel(base, "in")).toBe("9 x 2.25 in footprint, 1/4 in thick");
  });

  it("the size the buyer buys is the main part's, not the whole box", () => {
    expect(buyerSizeLabel(PLATE_ON_BASE)).toBe("8 x 2.5 in");
    expect(buyerSizeLabel(CUTTING_BOARD)).toBe("16 x 10 in");
  });

  it("a product of one piece carries no parts; two to four when it has them", () => {
    expect(CUTTING_BOARD).not.toHaveProperty("parts");
    const one = { ...PLATE_ON_BASE, parts: PLATE_ON_BASE.parts?.slice(0, 1) };
    expect(Product.safeParse(one).success).toBe(false);
  });
});

describe("views", () => {
  it("up to two more views, each named by its side", () => {
    const view = (label: string) => ({
      label,
      url: "https://stub.local/v.png",
    });
    expect(
      Product.safeParse({
        ...CUTTING_BOARD,
        views: [view("side"), view("top")],
      }).success,
    ).toBe(true);
    expect(
      Product.safeParse({
        ...CUTTING_BOARD,
        views: [view("side"), view("top"), view("back")],
      }).success,
    ).toBe(false);
    expect(
      Product.safeParse({ ...CUTTING_BOARD, views: [view("inside")] }).success,
    ).toBe(false);
  });
});

describe("productImages", () => {
  const sampled = {
    ...CUTTING_BOARD,
    colours: CUTTING_BOARD.colours.map((c, i) =>
      i === 0 ? { ...c, swatchUrl: "https://stub.local/maple.jpg" } : c,
    ),
  };
  const side = { label: "side" as const, url: "https://stub.local/side.png" };

  it("lists the sample, then each view, each with its place after the reference", () => {
    expect(productImages({ ...sampled, views: [side] })).toEqual([
      { url: "https://stub.local/maple.jpg", role: "sample", place: "second" },
      { url: "https://stub.local/side.png", role: "side", place: "third" },
    ]);
    expect(productImages({ ...CUTTING_BOARD, views: [side] })).toEqual([
      { url: "https://stub.local/side.png", role: "side", place: "second" },
    ]);
    expect(productImages(CUTTING_BOARD)).toEqual([]);
  });
});
