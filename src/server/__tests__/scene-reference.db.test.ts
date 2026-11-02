import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));
// The estimate only: no key is read and nothing is called.
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: () => true,
}));

// Each scene's request edits the image its camera calls for: Kiln's view from
// above for a camera looking down, the front for the rest (the throwaway
// Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "the reference each scene edits (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const repo = await import("@/server/project-repository");
    const { estimateProjectCards } = await import("@/server/generation-queue");
    const { upsertProducts } = await import("@/server/product-repository");
    const { planProject, withSlotTuning, withThreeQuarter } = await import(
      "@/domain/plan"
    );
    const { Product } = await import("@/domain/product");
    const { CATALOG } = await import("@/lib/recipes");
    const { photoReference, slotCards, startEditorState } = await import(
      "@/lib/project-start"
    );
    const { refreshCards } = await import("@/lib/project-refresh");

    const sku = `SR-${Date.now()}`;
    const created: string[] = [];
    afterAll(async () => {
      await db.project.deleteMany({ where: { id: { in: created } } });
      await db.product.deleteMany({ where: { sku } });
    });

    it("hero and in-use edit the view from above; the maker's eye level and the macro edit the front", async () => {
      const [product] = await upsertProducts([
        Product.parse({
          id: "pkg:SR",
          sku,
          name: "Reference test desk plate",
          family: "Office",
          dimensions: { w: 9, h: 2.78, d: 2.25, unit: "in" },
          shape: "name plate",
          material: "birch plywood",
          treatment: "engraved",
          colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
          defaultColour: "birch",
          typography: { family: "Fraunces" },
          source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
        }),
      ]);
      const master = photoReference(product);
      if (!master) throw new Error("no reference");
      const view = {
        assetUrl: "https://stub.local/above.png",
        angleDeg: 30,
        front: master.assetUrl,
      };
      const plan = withThreeQuarter(
        planProject({
          product,
          type: "listing-kit",
          destinationIds: ["etsy"],
          catalog: CATALOG,
        }),
        view,
      );
      const id = await repo.createProject({
        type: "listing-kit",
        product,
        plan,
        editor: startEditorState({
          product,
          type: "listing-kit",
          plan,
          master,
        }),
      });
      created.push(id);
      const used = async () =>
        Object.fromEntries(
          (
            await estimateProjectCards(id, [
              "etsy.hero",
              "etsy.in-use",
              "etsy.detail",
            ])
          ).cards.map((c) => [
            c.cardId,
            c.request.kind === "image" ? c.request.masterAssetUrl : null,
          ]),
        );
      expect(await used()).toEqual({
        "etsy.hero": view.assetUrl,
        "etsy.in-use": view.assetUrl,
        "etsy.detail": master.assetUrl,
      });
      await repo.changePlan(id, (p) =>
        withSlotTuning(
          p,
          { destinationId: "etsy", slotKey: "in-use" },
          { knob: "camera", stop: "eye" },
        ),
      );
      expect((await used())["etsy.in-use"]).toBe(master.assetUrl);

      // The maker's own reference: the view no longer applies, and the scene
      // Kiln started a little above is written again from the front.
      const heroText = async () =>
        (await repo.loadProjectBoard(id))?.board.cards.find(
          (c) => c.id === "etsy.hero",
        )?.fields.composition.value ?? "";
      expect(await heroText()).toContain("a little above");
      const own = {
        ...master,
        id: "own-reference",
        assetUrl: "https://stub.local/mine.jpg",
      };
      const loaded = await repo.loadProjectBoard(id);
      const current = loaded?.board.plan;
      if (!loaded || !current) throw new Error("no board");
      await repo.setProjectReference(
        id,
        own,
        [],
        refreshCards(
          loaded.board.cards,
          slotCards(current, own, product),
          own.id,
        ),
      );
      expect(await heroText()).not.toContain("a little above");
      expect((await used())["etsy.hero"]).toBe(own.assetUrl);
    });
  },
);
