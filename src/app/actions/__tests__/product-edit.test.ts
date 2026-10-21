import { afterEach, describe, expect, it, vi } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import type { Product } from "@/domain/product";
import { formFromProduct, productFromForm } from "@/lib/product-form";
import { productHash } from "@/server/product-version";

const stored = productFromForm(
  {
    name: "Engraved wood name keychain",
    whatItIs: "rounded rectangle keychain tag",
    width: 2.3,
    height: 1.25,
    unit: "in",
    material: "3 mm birch plywood, natural wood grain",
    treatment: "engraved",
    colours: [{ name: "Natural birch", hex: "#D9B98C" }],
    wording: [{ label: "Sofia" }],
    views: [],
  },
  "68iy",
);

const getProduct = vi.fn(
  async (_id: string): Promise<Product | null> => ({
    ...stored,
    id: "row-1",
  }),
);
const updateProduct = vi.fn(
  async (
    _id: string,
    product: Product,
  ): Promise<{
    product: Product;
    status: "updated" | "unchanged";
    changed: string[];
  }> => ({ product, status: "updated", changed: ["size", "text lines"] }),
);
const productProjects = vi.fn(async (_id: string) => [
  { projectId: "p-old", name: "Keychain — Listing kit", hash: "old" },
]);
const deleteProduct = vi.fn(
  async (_id: string) => ({ deleted: true }) as const,
);

vi.mock("@/server/product-repository", () => ({
  getProduct,
  updateProduct,
  productProjects,
  deleteProduct,
  upsertProducts: async () => [],
  importCatalog: async () => [],
  listProducts: async () => [],
}));

const { deleteProductAction, updateProductAction } = await import(
  "@/app/actions/products"
);

afterEach(() => vi.clearAllMocks());

describe("updateProductAction", () => {
  it("saves the fix over the same product and names the projects behind", async () => {
    const form = formFromProduct(stored);
    const result = await updateProductAction({
      id: "row-1",
      form: {
        ...form,
        width: 2.5,
        wording: [{ label: "Name", example: "Sofia", maxChars: null }],
      },
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.changed).toEqual(["size", "text lines"]);
    expect(result.behind).toEqual([
      { projectId: "p-old", name: "Keychain — Listing kit" },
    ]);
    const saved = updateProduct.mock.calls[0][1];
    expect(saved).toMatchObject({
      sku: stored.sku,
      dimensions: { w: 2.5 },
      wording: [{ label: "Name", example: "Sofia" }],
    });
  });

  it("a project already on the new version is not behind", async () => {
    productProjects.mockImplementationOnce(async () => [
      {
        projectId: "p-new",
        name: "Up to date",
        hash: productHash({ ...stored, id: "row-1" }),
      },
    ]);
    updateProduct.mockImplementationOnce(async (_id, product) => ({
      product,
      status: "unchanged",
      changed: [],
    }));
    const result = await updateProductAction({
      id: "row-1",
      form: formFromProduct(stored),
    });
    expect(result).toMatchObject({ status: "unchanged", behind: [] });
  });

  it("points a problem at its field, and refuses a catalog product", async () => {
    const result = await updateProductAction({
      id: "row-1",
      form: { ...formFromProduct(stored), name: "" },
    });
    expect(result).toMatchObject({ issues: [{ path: "name" }] });
    getProduct.mockImplementationOnce(async () => CUTTING_BOARD);
    expect(
      await updateProductAction({
        id: "cb",
        form: formFromProduct(CUTTING_BOARD),
      }),
    ).toMatchObject({ error: expect.stringContaining("catalog") });
    expect(updateProduct).not.toHaveBeenCalled();
  });
});

describe("deleteProductAction", () => {
  it("deletes an unused product, and names the projects using one", async () => {
    expect(await deleteProductAction("row-1")).toEqual({ deleted: true });
    deleteProduct.mockImplementationOnce(
      async () =>
        ({
          usedBy: [
            { projectId: "p-1", name: "Keychain — Listing kit", hash: null },
          ],
        }) as never,
    );
    expect(await deleteProductAction("row-1")).toEqual({
      error: "Used by Keychain — Listing kit: delete that project first.",
      usedBy: [{ projectId: "p-1", name: "Keychain — Listing kit" }],
    });
  });
});
