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
  const maker = enabled
    ? await (await import("@/server/maker-repository")).getCurrentMaker()
    : { id: "" };
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { estimateProjectCards } = await import("@/server/generation-queue");
  const { upsertProducts } = await import("@/server/product-repository");
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

  const start = async (
    destination = "etsy",
    type: "listing-kit" | "content" = "listing-kit",
  ) => {
    const [product] = await upsertProducts(maker, [
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
      type,
      destinationIds: [destination],
      catalog: CATALOG,
    });
    const id = await repo.createProject(maker, {
      type,
      product,
      plan,
      editor: startEditorState({
        product,
        type,
        plan,
        master: photoReference(product),
      }),
    });
    created.push(id);
    return id;
  };

  it("prices a scene at its model's low quality, on that model alone", async () => {
    const id = await start();
    const full = await estimateProjectCards(maker, id, ["etsy.hero"]);
    const test = await estimateProjectCards(maker, id, ["etsy.hero"], {
      test: true,
    });
    const [card] = test.cards;
    expect(card.request).toMatchObject({
      kind: "image",
      test: true,
      model: { quality: "low" },
    });
    expect(card.next).toEqual([]);
    expect(card.maxMicros).toBeLessThan(full.cards[0].maxMicros);
    await expect(
      estimateProjectCards(maker, id, ["etsy.video"], { test: true }),
    ).rejects.toThrow();
  });

  it("asks an Etsy scene at 2K and says so; a test take and an Instagram scene stay at 1K", async () => {
    const { estimateGeneration, sceneLookEstimate, toMicros } = await import(
      "@/domain/generation-cost"
    );
    const id = await start();
    const full = await estimateProjectCards(maker, id, ["etsy.hero"]);
    const [hero] = full.cards;
    expect(hero.request.model).toMatchObject({
      provider: "openai",
      model: "gpt-image-2",
      size: "2k",
    });
    const at2k = estimateGeneration(
      hero.request.model,
      hero.request.model.aspect,
      hero.request.kind === "image" ? hero.request.imageInputs.length : 0,
    );
    // A scene is looked at once it lands, and its estimate counts the look.
    const looking =
      hero.request.kind === "image" ? hero.request.look : undefined;
    expect(looking).toBeDefined();
    const look = looking ? sceneLookEstimate(looking) : null;
    expect(full.look).toEqual({ label: expect.any(String), count: 1 });
    expect(hero.typicalMicros).toBe(
      toMicros((at2k?.typical ?? 0) + (look?.typical ?? 0)),
    );
    expect(full.models[0]).toMatchObject({ resolution: "2K" });
    expect(full.model).toContain("medium 2K");
    const test = await estimateProjectCards(maker, id, ["etsy.hero"], {
      test: true,
    });
    expect(test.cards[0].request.model).toMatchObject({ size: "1k" });
    // A test take, a cheap check of the direction, goes without the look.
    expect(test.cards[0].request).not.toHaveProperty("look");
    expect(test.look).toBeNull();

    const feed = await start("instagram", "content");
    // A scene of its own: a version (Story, Square post) waits for its source.
    const scene = await db.card.findFirstOrThrow({
      where: { projectId: feed, type: "image", cardId: "instagram.hook" },
    });
    const post = await estimateProjectCards(maker, feed, [scene.cardId]);
    expect(post.cards[0].request.model).toMatchObject({ size: "1k" });
    expect(post.models[0].resolution).toBeNull();
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
      estimateProjectCards(maker, id, ["etsy.hero"], { test: true }),
    ).rejects.toThrow("has no low quality");

    // A finished test take on the in-use scene.
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
        maker,
        id,
        { destinationId: "etsy", slotKey: "in-use" },
        true,
      ),
    ).rejects.toThrow("That is a test take");
  });
});
