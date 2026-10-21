import { afterAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("product repository (database)", async () => {
  const { db } = await import("@/lib/db");
  const { deleteProduct, importCatalog, productProjects, updateProduct } =
    await import("@/server/product-repository");
  const repo = await import("@/server/project-repository");
  const { planProject } = await import("@/domain/plan");
  const { CATALOG } = await import("@/lib/recipes");
  const { startEditorState } = await import("@/lib/project-start");
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

  const projects: string[] = [];

  afterAll(async () => {
    const maker = await getCurrentMaker();
    await db.project.deleteMany({ where: { id: { in: projects } } });
    await db.product.deleteMany({
      where: { makerId: maker.id, sku: { in: [sku, `${sku}-E`] } },
    });
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

  it("saves an edit over its own row, keeping its sku, or writes nothing", async () => {
    const [created] = await importCatalog([{ ...product, sku: `${sku}-E` }]);
    const id = created.product.id;
    const row = await db.product.findFirstOrThrow({ where: { id } });

    const same = await updateProduct(id, created.product);
    expect(same).toMatchObject({ status: "unchanged", changed: [] });
    expect(
      (await db.product.findFirstOrThrow({ where: { id } })).updatedAt,
    ).toEqual(row.updatedAt);

    const edited = await updateProduct(id, {
      ...created.product,
      name: "Renamed board",
      sku: "something-else",
      material: "solid oak",
    });
    expect(edited.status).toBe("updated");
    expect(edited.changed).toEqual(["name", "material"]);
    expect(edited.product).toMatchObject({ id, sku: `${sku}-E` });
  });

  it("deletes a product no project uses, and names the projects that do", async () => {
    const [created] = await importCatalog([
      { ...product, sku: `${sku}-E`, name: "Delete test board" },
    ]);
    const id = created.product.id;
    const plan = planProject({
      product: created.product,
      type: "listing-kit",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const projectId = await repo.createProject({
      type: "listing-kit",
      product: created.product,
      plan,
      editor: startEditorState({
        product: created.product,
        type: "listing-kit",
        plan,
        master: null,
      }),
    });
    projects.push(projectId);
    const uses = await productProjects(id);
    expect(uses.map((u) => u.projectId)).toEqual([projectId]);
    expect(await deleteProduct(id)).toMatchObject({
      usedBy: [{ projectId }],
    });
    await db.project.delete({ where: { id: projectId } });
    expect(await deleteProduct(id)).toEqual({ deleted: true });
    expect(await db.product.findFirst({ where: { id } })).toBeNull();
  });
});
