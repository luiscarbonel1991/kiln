import { describe, expect, it } from "vitest";
import { buyerSizeLabel, Product, partLabel } from "@/domain/product";
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
