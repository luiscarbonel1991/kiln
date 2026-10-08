import { describe, expect, it } from "vitest";
import pkg from "@/lib/__fixtures__/product-package.json";
import { parseProductPackage } from "@/lib/product-package";
import { productHash } from "@/server/product-version";

const parsed = parseProductPackage(pkg);
if (!parsed.ok) throw new Error("fixture package does not parse");
const [board] = parsed.products;

describe("productHash", () => {
  it("is the product's content: the row id and key order do not change it", () => {
    const shuffled = Object.fromEntries(
      Object.entries(board).reverse(),
    ) as typeof board;
    expect(productHash({ ...shuffled, id: "row-2" })).toBe(productHash(board));
  });

  it("any real change gives a new version", () => {
    expect(productHash({ ...board, material: "oak" })).not.toBe(
      productHash(board),
    );
  });
});
