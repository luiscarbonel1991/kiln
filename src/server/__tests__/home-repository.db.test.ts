import { afterAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("home stats (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { homeStats } = await import("@/server/home-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { Product } = await import("@/domain/product");

  const sku = `HS-${Date.now()}`;
  const product = Product.parse({
    id: "pkg:HS-01",
    sku,
    name: "Home stats board",
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
  const kept = `https://stub.local/kept-${Date.now()}.png`;
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
            approvedOutput: kept,
          },
          {
            key: "in-use",
            label: "In use",
            purpose: "Use.",
            fill: "scene" as const,
          },
          {
            key: "gift",
            label: "Gift",
            purpose: "Gift.",
            fill: "scene" as const,
            off: true,
          },
          {
            key: "size",
            label: "Size",
            purpose: "Size.",
            fill: "exact" as const,
            exact: "size-spec" as const,
          },
        ],
      },
    ],
  };
  const created: string[] = [];

  afterAll(async () => {
    await db.generationJob.deleteMany({
      where: { projectId: { in: created } },
    });
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  it("counts what each project spent and kept, and this month's approved outputs", async () => {
    const maker = await getCurrentMaker();
    const [saved] = await upsertProducts(maker, [product]);
    const id = await repo.createProject(maker, {
      type: "launch",
      product: saved,
      plan,
      editor: {
        name: "Home stats launch",
        phase: "generation",
        master: null,
        understanding: null,
        recipeId: "etsy-listing@etsy",
        planning: null,
        cards: [],
      },
    });
    created.push(id);
    const job = (cardId: string, outputUrl: string, actualMicros: number) => ({
      makerId: maker.id,
      projectId: id,
      cardId,
      mode: "live",
      status: "done",
      maxAttempts: 2,
      estimateMicros: 60_000,
      actualMicros,
      outputUrl,
      finishedAt: new Date(),
    });
    await db.generationJob.createMany({
      data: [
        job("etsy.hero", kept, 50_000),
        job("etsy.in-use", "https://stub.local/not-kept.png", 40_000),
        // Mock jobs cost nothing.
        {
          ...job("etsy.in-use", "https://stub.local/mock.png", 0),
          mode: "mock",
        },
      ],
    });
    const before = await homeStats(maker.id);
    expect(before.projects.get(id)).toEqual({
      spentMicros: 90_000,
      slots: 2,
      approved: 1,
    });
    expect(before.monthApproved).toBeGreaterThanOrEqual(1);
  });
});
