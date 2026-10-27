import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));
// A connected shop: the mock one, whatever mode the tests run in.
vi.mock("@/providers/shop", async (original) => {
  const shop = await original<typeof import("@/providers/shop")>();
  return { ...shop, shopConnector: () => shop.mockShop };
});

// A delivered listing's reads kept, refused before delivery, read from the
// shop, and listed with what is due (the throwaway Postgres: see
// project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("a listing's results (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const results = await import("@/server/listing-results");
  const { upsertProducts } = await import("@/server/product-repository");
  const { planProject, withListingUrl } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { localDate } = await import("@/lib/results-view");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );

  const sku = `LR-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  // A listing kit for Etsy and Instagram, its Etsy frames delivered on a day
  // (an exact frame needs no approval to be delivered).
  async function delivered(at: string | null) {
    const [product] = await upsertProducts([
      Product.parse({
        id: "pkg:LR",
        sku,
        name: "Results test coaster",
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
    const plan = planProject({
      product,
      type: "launch",
      destinationIds: ["etsy", "instagram"],
      catalog: CATALOG,
    });
    const id = await repo.createProject({
      type: "launch",
      product,
      plan,
      editor: startEditorState({
        product,
        type: "launch",
        plan,
        master: photoReference(product),
      }),
    });
    created.push(id);
    if (at) {
      const exact = plan.destinations[0].slots
        .filter((s) => s.fill === "exact")
        .map((s) => ({ key: s.key }));
      await repo.setDelivered(id, "etsy", exact, at);
    }
    return id;
  }

  const today = "2026-10-27";

  it("keeps a typed read in its own window, and refuses one before delivery or with bad numbers", async () => {
    const early = await delivered(null);
    await expect(
      results.saveRead({
        projectId: early,
        destinationId: "etsy",
        key: "before",
        read: { visits: 40 },
        source: "typed",
        today,
      }),
    ).rejects.toThrow(/Deliver this destination first/);

    const id = await delivered("2026-10-27T15:00:00.000Z");
    const liveOn = localDate("2026-10-27T15:00:00.000Z");
    const saved = await results.saveRead({
      projectId: id,
      destinationId: "etsy",
      key: "before",
      read: { visits: 40, orders: 2, source: " " },
      source: "typed",
      today,
    });
    expect(saved).toMatchObject({
      visits: 40,
      orders: 2,
      source: "typed",
      readOn: today,
      to: (await import("@/domain/listing-results")).addDays(liveOn, -1),
    });
    const loaded = await repo.loadProjectBoard(id);
    expect(loaded?.board.plan?.destinations[0].results?.reads.before).toEqual(
      saved,
    );

    await expect(
      results.saveRead({
        projectId: id,
        destinationId: "etsy",
        key: "day14",
        read: { visits: 2.5 },
        source: "typed",
        today,
      }),
    ).rejects.toThrow("Visits must be a whole number of 0 or more.");
    await expect(
      results.saveRead({
        projectId: id,
        destinationId: "instagram",
        key: "day14",
        read: { visits: 3 },
        source: "typed",
        today,
      }),
    ).rejects.toThrow(/not a sale destination/);
  });

  it("reads a passed window from the shop once the listing's address is known", async () => {
    const id = await delivered("2026-10-01T15:00:00.000Z");
    await expect(
      results.readFromShop({
        projectId: id,
        destinationId: "etsy",
        key: "before",
        today,
      }),
    ).rejects.toThrow(/listing's address/);
    await repo.changePlan(id, (plan) =>
      withListingUrl(plan, "etsy", "https://www.etsy.com/listing/4413933723/x"),
    );
    const before = await results.readFromShop({
      projectId: id,
      destinationId: "etsy",
      key: "before",
      today,
    });
    expect(before.source).toBe("Mock shop");
    expect(before.visits).toBeGreaterThan(0);
    // The 30-day window is still running on 10/27.
    await expect(
      results.readFromShop({
        projectId: id,
        destinationId: "etsy",
        key: "day30",
        today,
      }),
    ).rejects.toThrow(/once its days have passed/);

    const listed = (await results.followedListings(today)).find(
      (l) => l.projectId === id,
    );
    expect(listed).toMatchObject({
      destinationId: "etsy",
      family: "Home",
      view: { next: { key: "day30" } },
    });
    expect(listed?.view.reads.filter((r) => r.due).map((r) => r.key)).toEqual([
      "day14",
    ]);
  });

  it("takes the before read at delivery when a shop is connected", async () => {
    const id = await delivered(null);
    await repo.changePlan(id, (plan) =>
      withListingUrl(plan, "etsy", "https://www.etsy.com/listing/4413933723/x"),
    );
    const exact = (
      await repo.loadProjectBoard(id)
    )?.board.plan?.destinations[0].slots
      .filter((s) => s.fill === "exact")
      .map((s) => ({ key: s.key }));
    await repo.setDelivered(id, "etsy", exact ?? [], new Date().toISOString());
    await results.readBeforeAtDelivery(id, "etsy");
    const plan = (await repo.loadProjectBoard(id))?.board.plan;
    expect(plan?.destinations[0].results?.reads.before?.source).toBe(
      "Mock shop",
    );
    // A second delivery keeps the read it has.
    const kept = plan?.destinations[0].results?.reads.before;
    await results.readBeforeAtDelivery(id, "etsy");
    expect(
      (await repo.loadProjectBoard(id))?.board.plan?.destinations[0].results
        ?.reads.before,
    ).toEqual(kept);
  });
});
