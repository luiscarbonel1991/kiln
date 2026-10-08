import { afterAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("product repository (database)", async () => {
  const { db } = await import("@/lib/db");
  const { importCatalog } = await import("@/server/product-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { Product } = await import("@/domain/product");

  const sku = `IC-${Date.now()}`;
  const product = Product.parse({
    id: "pkg:IC-01",
    sku,
    name: "Import test board",
    family: "Kitchen",
    dimensions: { w: 10, h: 6, unit: "in" },
    shape: "board",
    material: "hardwood",
    treatment: "engraved",
    colours: [{ key: "oak", name: "Oak", face: "#C8A165" }],
    defaultColour: "oak",
    typography: { family: "Fraunces" },
    source: { kind: "form" },
  });

  afterAll(async () => {
    const maker = await getCurrentMaker();
    await db.product.deleteMany({ where: { makerId: maker.id, sku } });
  });

  it("says whether each product is new, updated (and what changed) or unchanged", async () => {
    const [first] = await importCatalog([product]);
    expect(first).toMatchObject({ status: "new", changed: [] });
    const row = await db.product.findFirstOrThrow({ where: { sku } });

    const [same] = await importCatalog([{ ...product, id: "other" }]);
    expect(same).toMatchObject({ status: "unchanged", changed: [] });
    expect(same.product.id).toBe(first.product.id);
    // Nothing was written: updatedAt still means the last real change.
    const untouched = await db.product.findFirstOrThrow({ where: { sku } });
    expect(untouched.updatedAt).toEqual(row.updatedAt);

    const [updated] = await importCatalog([
      { ...product, material: "solid oak" },
    ]);
    expect(updated).toMatchObject({ status: "updated", changed: ["material"] });
    expect(updated.product.id).toBe(first.product.id);
  });
});
