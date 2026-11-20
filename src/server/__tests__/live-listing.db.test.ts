import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));

// A Listing kit started from a live listing, saved and read back (the
// throwaway Postgres: see project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)(
  "a project from a live listing (database)",
  async () => {
    const maker = enabled
      ? await (await import("@/server/maker-repository")).getCurrentMaker()
      : { id: "" };
    const { db } = await import("@/lib/db");
    const repo = await import("@/server/project-repository");
    const { upsertProducts } = await import("@/server/product-repository");
    const { planFromListing, slotState } = await import("@/domain/plan");
    const { Product } = await import("@/domain/product");
    const { CATALOG } = await import("@/lib/recipes");
    const { photoReference, startEditorState } = await import(
      "@/lib/project-start"
    );

    const sku = `LL-${Date.now()}`;
    const created: string[] = [];
    afterAll(async () => {
      await db.project.deleteMany({ where: { id: { in: created } } });
      await db.product.deleteMany({ where: { sku } });
    });

    it("keeps the listing's address, its kept photos and what each frame replaces", async () => {
      const [product] = await upsertProducts(maker, [
        Product.parse({
          id: "pkg:LL",
          sku,
          name: "Live listing coaster",
          family: "Home",
          dimensions: { w: 4, h: 4, unit: "in" },
          shape: "round coaster",
          material: "birch plywood",
          treatment: "engraved",
          colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
          defaultColour: "birch",
          typography: { family: "Fraunces" },
          source: { kind: "photo", assetUrl: "https://stub.local/coaster.png" },
        }),
      ]);
      const listingUrl = "https://www.etsy.com/listing/123456789/coaster";
      const plan = planFromListing({
        product,
        destinationId: "etsy",
        catalog: CATALOG,
        listingUrl,
        photos: [
          {
            url: "https://storage.test/listings/a.jpg",
            aspect: "4:3",
            replaceWith: "hero",
          },
          { url: "https://storage.test/listings/b.jpg", aspect: "1:1" },
        ],
      });
      const editor = startEditorState({
        product,
        type: "listing-kit",
        plan,
        master: photoReference(product),
      });
      const id = await repo.createProject(maker, {
        type: "listing-kit",
        product,
        plan,
        editor,
      });
      created.push(id);

      const loaded = await repo.loadProjectBoard(maker, id);
      const etsy = loaded?.board.plan?.destinations[0];
      expect(etsy?.listingUrl).toBe(listingUrl);
      expect(etsy?.slots.map((s) => s.key)).toEqual(["hero", "live-2"]);
      expect(etsy?.slots[0].before).toEqual({
        url: "https://storage.test/listings/a.jpg",
        aspect: "4:3",
      });
      const kept = etsy?.slots[1];
      if (!kept) throw new Error("no kept photo");
      expect(slotState(kept).state).toBe("kept");
      // Only the hero has a card: a kept photo is never generated.
      expect(loaded?.board.cards.map((c) => c.id)).toEqual(["etsy.hero"]);
    });
  },
);
