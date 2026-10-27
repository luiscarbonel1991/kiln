import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));

// A listing's market brief saved, read back, and brought to the product's next
// project (the throwaway Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("a market brief (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { MarketBrief } = await import("@/domain/market-brief");
  const { planProject } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );

  const sku = `MB-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  const brief = (term: string) =>
    MarketBrief.parse({
      searches: [
        {
          term,
          searches: 5700,
          conversion: "high",
          price: { low: 14.4, high: 17.6 },
          source: "Etsy Marketplace Insights",
          readOn: "2026-09-27",
        },
      ],
      notes: [
        {
          term,
          note: "Close crops on a wooden table.",
          place: "a farmhouse table",
          readOn: "2026-10-01",
        },
      ],
    });

  async function start(name: string) {
    const [product] = await upsertProducts([
      Product.parse({
        id: "pkg:MB",
        sku,
        name: "Brief test coaster",
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
    await repo.renameProject(id, name);
    created.push(id);
    return { id, product };
  }

  it("is kept per destination, read back on the board, and cleared when empty", async () => {
    const { id } = await start("Brief board");
    await repo.setBrief(id, "etsy", brief("cork coaster"));
    const loaded = await repo.loadProjectBoard(id);
    const [etsy, instagram] = loaded?.board.plan?.destinations ?? [];
    expect(etsy.brief).toEqual(brief("cork coaster"));
    expect(instagram.brief).toBeUndefined();
    await repo.setBrief(id, "etsy", undefined);
    expect(
      (await repo.loadProjectBoard(id))?.board.plan?.destinations[0],
    ).not.toHaveProperty("brief");
    await expect(repo.setBrief(id, "nowhere", brief("x"))).rejects.toThrow(
      /not a destination/,
    );
  });

  it("the product's newest brief per destination is the one a new project starts from", async () => {
    const older = await start("Older listing kit");
    await repo.setBrief(older.id, "etsy", brief("coaster set"));
    const newer = await start("Newer listing kit");
    await repo.setBrief(newer.id, "etsy", brief("cork coaster"));
    // A project without a brief there does not hide the newest one.
    await start("No brief yet");
    const found = await repo.latestBriefs(newer.product.id);
    expect(found.etsy).toEqual({
      brief: brief("cork coaster"),
      projectName: "Newer listing kit",
    });
    expect(found.instagram).toBeUndefined();
  });
});
