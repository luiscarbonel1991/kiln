import { describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("maker brand kit (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/maker-repository");
  const { importProductsAction } = await import("@/app/actions/products");

  it("importing a package with a maker block saves the brand kit", async () => {
    const result = await importProductsAction({
      maker: { palette: ["#2F4A3A"], handle: "@brandtest" },
      products: [
        {
          id: "brandtest:BT-01",
          sku: "BT-01",
          name: "Brand test mug",
          family: "Kitchen",
          dimensions: { w: 3, h: 4, unit: "in" },
          shape: "mug",
          material: "stoneware",
          treatment: "printed",
          colours: [{ key: "white", name: "White", face: "#FFFFFF" }],
          defaultColour: "white",
          typography: { family: "Hanken Grotesk" },
          source: { kind: "form" },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(await repo.getMakerBrand()).toEqual({
      palette: ["#2F4A3A"],
      handle: "brandtest",
    });
  });

  it("a stale brand row reads as none, never throws", async () => {
    const maker = await repo.getCurrentMaker();
    await db.maker.update({
      where: { id: maker.id },
      data: { brand: { palette: "not a list" } },
    });
    expect(await repo.getMakerBrand()).toBeNull();
    await db.maker.update({
      where: { id: maker.id },
      data: { brand: null as never },
    });
    await db.product.deleteMany({
      where: { makerId: maker.id, sku: "BT-01" },
    });
  });
});
