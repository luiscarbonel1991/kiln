import { afterAll, describe, expect, it } from "vitest";

// Integration test against a real, throwaway Postgres. Skipped unless
// KILN_DB_TESTS=1 and DATABASE_URL points at a migrated test database:
//   docker exec kiln-postgres createdb -U kiln kiln_test
//   DATABASE_URL=postgresql://kiln:kiln@localhost:5444/kiln_test pnpm db:deploy
//   KILN_DB_TESTS=1 DATABASE_URL=postgresql://kiln:kiln@localhost:5444/kiln_test pnpm vitest run project-repository.db
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("project repository (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { Product } = await import("@/domain/product");

  const product = Product.parse({
    id: "pkg:DB-01",
    sku: `DB-${Date.now()}`,
    name: "Test board",
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
  const master = {
    id: "m-1",
    origin: "product" as const,
    sourcePrompt: null,
    assetUrl: "https://stub.local/plate.png",
    mime: "image/png",
  };
  const field = { value: "x", source: "recipe" as const, locked: false };
  const fields = {
    subject: field,
    materials: field,
    scene: field,
    composition: field,
    lighting: field,
    mood: field,
    palette: field,
  };
  const card = (cardId: string, outputs: string[]) => ({
    id: cardId,
    parentId: null,
    masterAssetId: "m-1",
    recipeId: "etsy-listing@etsy",
    type: "image" as const,
    direction: cardId,
    fields,
    references: [],
    model: {
      provider: "openai" as const,
      model: "gpt-image-2",
      aspect: "1:1",
      guidance: 7.5,
      strength: 0.65,
    },
    outputs,
    status: "done" as const,
  });
  const plan = {
    destinations: [
      {
        destinationId: "etsy",
        shotListId: "etsy-listing",
        slots: [
          {
            key: "hero",
            label: "Hero",
            purpose: "Win.",
            fill: "scene" as const,
          },
          {
            key: "in-use",
            label: "In use",
            purpose: "Use.",
            fill: "scene" as const,
          },
        ],
      },
    ],
  };
  const editor = {
    name: "DB test launch",
    phase: "generation" as const,
    master,
    understanding: null,
    recipeId: "etsy-listing@etsy",
    planning: null,
    cards: [
      card("etsy.hero", ["https://stub.local/hero.png"]),
      card("etsy.in-use", ["https://stub.local/in-use.png"]),
    ],
  };
  const created: string[] = [];

  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku: product.sku } });
  });

  it("creates a planned project with its product, master and cards", async () => {
    const [saved] = await upsertProducts([product]);
    const id = await repo.createProject({
      type: "launch",
      productId: saved.id,
      plan,
      editor,
    });
    created.push(id);
    const loaded = await repo.loadProjectBoard(id);
    expect(loaded?.board.type).toBe("launch");
    expect(loaded?.board.plan?.destinations[0].slots).toHaveLength(2);
    expect(loaded?.board.cards.map((c) => c.id)).toEqual([
      "etsy.hero",
      "etsy.in-use",
    ]);
    expect(loaded?.product?.sku).toBe(product.sku);
    const [again] = await upsertProducts([product]);
    expect(again.id).toBe(saved.id);
  });

  it("an editor autosave keeps a planned project's type and plan", async () => {
    const id = created[0];
    await repo.saveProject({ ...editor, recipeId: "recipe-laser-lineart" }, id);
    const row = await db.project.findUniqueOrThrow({ where: { id } });
    expect(row.type).toBe("launch");
    expect(row.plan).not.toBeNull();
  });

  it("two approvals at once on different slots both persist", async () => {
    const id = created[0];
    await Promise.all([
      repo.setSlotApproval(
        id,
        { destinationId: "etsy", slotKey: "hero" },
        true,
      ),
      repo.setSlotApproval(
        id,
        { destinationId: "etsy", slotKey: "in-use" },
        true,
      ),
    ]);
    const loaded = await repo.loadProjectBoard(id);
    expect(
      loaded?.board.plan?.destinations[0].slots.map((s) => s.approvedOutput),
    ).toEqual(["https://stub.local/hero.png", "https://stub.local/in-use.png"]);
  });

  it("a studio project still follows its recipe's type on autosave", async () => {
    const id = await repo.saveProject({
      ...editor,
      recipeId: "recipe-etsy-hero",
    });
    created.push(id);
    await repo.saveProject({ ...editor, recipeId: "recipe-laser-lineart" }, id);
    const row = await db.project.findUniqueOrThrow({ where: { id } });
    expect(row.type).toBe("design");
    expect(row.plan).toBeNull();
  });
});
