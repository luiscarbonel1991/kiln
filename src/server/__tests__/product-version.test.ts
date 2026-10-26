import { describe, expect, it } from "vitest";
import pkg from "@/lib/__fixtures__/product-package.json";
import { parseProductPackage } from "@/domain/product-package";
import { productDrift, productHash } from "@/server/product-version";

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

describe("productDrift", () => {
  const dates = {
    productUpdatedAt: new Date("2026-10-07T10:00:00Z"),
    projectCreatedAt: new Date("2026-10-06T10:00:00Z"),
  };

  it("a project built from this version is current", () => {
    expect(
      productDrift(board, {
        snapshot: board,
        hash: productHash(board),
        ...dates,
      }),
    ).toEqual({ stale: false, changed: [] });
  });

  it("a project built from an earlier version says what changed since", () => {
    const now = { ...board, material: "solid oak" };
    expect(
      productDrift(now, {
        snapshot: board,
        hash: productHash(board),
        ...dates,
      }),
    ).toEqual({ stale: true, changed: ["material"] });
  });

  it("a project from before versions is judged by the dates", () => {
    expect(
      productDrift(board, { snapshot: null, hash: null, ...dates }),
    ).toEqual({ stale: true, changed: [] });
    expect(
      productDrift(board, {
        snapshot: null,
        hash: null,
        productUpdatedAt: dates.projectCreatedAt,
        projectCreatedAt: dates.productUpdatedAt,
      }).stale,
    ).toBe(false);
  });
});
