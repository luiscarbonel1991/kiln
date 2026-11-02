import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));
// The estimate only: no key is read and nothing is called.
vi.mock("@/providers/keys", async (original) => ({
  ...(await original<typeof import("@/providers/keys")>()),
  hasProviderKey: () => true,
}));

// A test take: a scene at its model's low quality, on that model alone, and
// never approved (the throwaway Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("test takes (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { estimateProjectCards } = await import("@/server/generation-queue");
  const { upsertProducts } = await import("@/server/product-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { planProject } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );

  const sku = `TT-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.generationJob.deleteMany({
      where: { projectId: { in: created } },
    });
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  const start = async () => {
    const [product] = await upsertProducts([
      Product.parse({
        id: "pkg:TT",
        sku,
        name: "Test take coaster",
        family: "Home",
        dimensions: { w: 4, h: 4, unit: "in" },
        shape: "round coaster",
        material: "birch plywood",
        treatment: "engraved",
        colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
        defaultColour: "birch",
        typography: { family: "Fraunces" },
        source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
      }),
    ]);
    const plan = planProject({
      product,
      type: "listing-kit",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const id = await repo.createProject({
      type: "listing-kit",
      product,
      plan,
      editor: startEditorState({
        product,
        type: "listing-kit",
        plan,
        master: photoReference(product),
      }),
    });
    created.push(id);
    return id;
  };

  it("prices a scene at its model's low quality, on that model alone", async () => {
    const id = await start();
    const full = await estimateProjectCards(id, ["etsy.hero"]);
    const test = await estimateProjectCards(id, ["etsy.hero"], { test: true });
    const [card] = test.cards;
    expect(card.request).toMatchObject({
      kind: "image",
      test: true,
      model: { quality: "low" },
    });
    expect(card.next).toEqual([]);
    expect(card.maxMicros).toBeLessThan(full.cards[0].maxMicros);
    await expect(
      estimateProjectCards(id, ["etsy.video"], { test: true }),
    ).rejects.toThrow();
  });

  it("refuses a model with no low quality, and the approval of a test take", async () => {
    const id = await start();
    await db.card.update({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.hero" } },
      data: {
        model: {
          provider: "google",
          model: "gemini-nano-banana-2.1",
          aspect: "1:1",
        },
      },
    });
    await expect(
      estimateProjectCards(id, ["etsy.hero"], { test: true }),
    ).rejects.toThrow("has no low quality");

    // A finished test take on the in-use scene.
    const maker = await getCurrentMaker();
    const take = "https://stub.local/cards/in-use-test.png";
    await db.generationJob.create({
      data: {
        makerId: maker.id,
        projectId: id,
        cardId: "etsy.in-use",
        mode: "mock",
        status: "done",
        attempt: 1,
        maxAttempts: 1,
        estimateMicros: 6000,
        outputUrl: take,
        request: { kind: "image", test: true },
        finishedAt: new Date(),
      },
    });
    await db.card.update({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.in-use" } },
      data: { outputs: [take], status: "done" },
    });
    await expect(
      repo.setSlotApproval(
        id,
        { destinationId: "etsy", slotKey: "in-use" },
        true,
      ),
    ).rejects.toThrow("That is a test take");
  });
});
