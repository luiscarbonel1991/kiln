import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "product changed — update the project (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const repo = await import("@/server/project-repository");
    const { upsertProducts } = await import("@/server/product-repository");
    const { updateProjectProductAction } = await import("@/app/actions/board");
    const { productDrift } = await import("@/server/product-version");
    const { planProject } = await import("@/domain/plan");
    const { Product } = await import("@/domain/product");
    const { CATALOG } = await import("@/lib/recipes");
    const { photoReference, startEditorState } = await import(
      "@/lib/project-start"
    );

    const sku = `PR-${Date.now()}`;
    const product = Product.parse({
      id: "pkg:PR-01",
      sku,
      name: "Refresh test coaster",
      family: "Home",
      dimensions: { w: 4, h: 4, unit: "in" },
      shape: "round coaster",
      material: "birch plywood",
      treatment: "engraved",
      colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
      defaultColour: "birch",
      typography: { family: "Fraunces" },
      useContexts: ["a coffee table"],
      source: { kind: "photo", assetUrl: "https://stub.local/coaster.png" },
    });
    const created: string[] = [];

    afterAll(async () => {
      await db.project.deleteMany({ where: { id: { in: created } } });
      await db.product.deleteMany({ where: { sku } });
    });

    it("brings the project to the product's current version, keeping the maker's own edits", async () => {
      const [saved] = await upsertProducts([product]);
      const plan = planProject({
        product: saved,
        type: "launch",
        destinationIds: ["etsy"],
        catalog: CATALOG,
      });
      const editor = startEditorState({
        product: saved,
        type: "launch",
        plan,
        master: photoReference(saved),
      });
      const id = await repo.createProject({
        type: "launch",
        product: saved,
        plan,
        editor,
      });
      created.push(id);
      const [first] = editor.cards;
      await db.card.update({
        where: { projectId_cardId: { projectId: id, cardId: first.id } },
        data: {
          fields: {
            ...first.fields,
            mood: { value: "moody blue", source: "local", locked: false },
          },
        },
      });

      const [changed] = await upsertProducts([
        { ...saved, material: "solid oak" },
      ]);
      const before = await repo.loadProjectBoard(id);
      if (!before?.version || !before.product) throw new Error("no version");
      expect(productDrift(before.product, before.version)).toEqual({
        stale: true,
        changed: ["material"],
      });

      expect(
        await updateProjectProductAction({ projectId: id }),
      ).toBeUndefined();

      const after = await repo.loadProjectBoard(id);
      if (!after?.version) throw new Error("no version");
      expect(productDrift(changed, after.version).stale).toBe(false);
      const card = after.board.cards.find((c) => c.id === first.id);
      expect(card?.fields.mood).toEqual({
        value: "moody blue",
        source: "local",
        locked: false,
      });
      expect(card?.fields.subject.value).toContain("solid oak");
      const row = await db.project.findUniqueOrThrow({ where: { id } });
      expect(JSON.stringify(row.understanding)).toContain("solid oak");
    });
  },
);
