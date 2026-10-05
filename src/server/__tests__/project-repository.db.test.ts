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
    understanding: {
      subject: "test board",
      productType: "board",
      useContext: "",
      sceneProps: "",
      materials: "hardwood",
      lighting: "soft",
      composition: "centered",
      mood: "calm",
      palette: ["#C8A165"],
    },
    recipeId: "etsy-listing@etsy",
    planning: null,
    cards: [
      card("etsy.hero", ["https://stub.local/hero.png"]),
      card("etsy.in-use", ["https://stub.local/in-use.png"]),
    ],
  };
  const created: string[] = [];

  afterAll(async () => {
    await db.generationJob.deleteMany({
      where: { projectId: { in: created } },
    });
    await db.generationBatch.deleteMany({
      where: { projectId: { in: created } },
    });
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

  it("a stale autosave never reverts a worker's result, the reference or the card set", async () => {
    const id = created[0];
    // The queue finishes etsy.hero after the editor last loaded the project.
    await db.card.update({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.hero" } },
      data: { outputs: ["https://stub.local/worker.png"], status: "done" },
    });
    // The stale editor still has the old output, another master and only one
    // card, plus one real edit (a prompt override) that must land.
    const [hero] = editor.cards;
    await repo.saveProject(
      {
        ...editor,
        master: {
          ...master,
          id: "m-2",
          assetUrl: "https://stub.local/other.png",
        },
        cards: [
          { ...hero, status: "draft", outputs: [], promptOverride: "closer" },
        ],
      },
      id,
    );
    const cards = await db.card.findMany({
      where: { projectId: id },
      orderBy: { cardId: "asc" },
    });
    expect(cards.map((c) => c.cardId)).toEqual(["etsy.hero", "etsy.in-use"]);
    const saved = cards.find((c) => c.cardId === "etsy.hero");
    expect(saved?.outputs).toEqual(["https://stub.local/worker.png"]);
    expect(saved?.status).toBe("done");
    expect(saved?.promptOverride).toBe("closer");
    const anchor = await db.masterAsset.findUniqueOrThrow({
      where: { projectId: id },
    });
    expect(anchor.assetUrl).toBe(master.assetUrl);
  });

  it("the editor's direct output write does not apply to a planned project", async () => {
    const id = created[0];
    await repo.saveCardOutput(
      id,
      "etsy.in-use",
      "https://stub.local/direct.png",
    );
    const card = await db.card.findUniqueOrThrow({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.in-use" } },
    });
    expect(card.outputs).not.toEqual(["https://stub.local/direct.png"]);
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
    ).toEqual([
      "https://stub.local/worker.png",
      "https://stub.local/in-use.png",
    ]);
  });

  it("queue end to end: estimate, enqueue, a worker run puts the output on the card", async () => {
    const { estimateProjectCards } = await import("@/server/generation-queue");
    const queueRepo = await import("@/server/generation-repository");
    const { createWorker } = await import("@/server/generation-worker");
    const { getCurrentMaker } = await import("@/server/maker-repository");
    const id = created[0];
    const { cards, model } = await estimateProjectCards(id, ["etsy.in-use"]);
    expect(cards[0].request.masterAssetUrl).toBe(master.assetUrl);
    expect(cards[0].request.model.provider).toBe("openai");
    const maker = await getCurrentMaker();
    await queueRepo.enqueueBatch({
      makerId: maker.id,
      projectId: id,
      mode: "mock",
      model,
      jobs: cards.map((c) => ({
        cardId: c.cardId,
        request: c.request,
        estimateMicros: c.maxMicros,
      })),
    });
    const worker = createWorker({
      mode: "mock",
      concurrency: 2,
      leaseSec: 60,
      renewMs: 60_000,
      sweepMs: 60_000,
      callTimeoutMs: 10_000,
      claimJobs: queueRepo.claimJobs,
      renewLease: queueRepo.renewLease,
      markCallStarted: queueRepo.markCallStarted,
      recordCost: queueRepo.recordCost,
      completeJob: queueRepo.completeJob,
      failJob: queueRepo.failJob,
      requeueExpired: queueRepo.requeueExpired,
      overCap: async () => false,
      provider: () =>
        ({
          id: "openai",
          editBytes: async () => ({
            bytes: new Uint8Array([1]),
            mime: "image/png",
            model: "gpt-image-2",
            usage: { inputTextTokens: 1, inputImageTokens: 1, outputTokens: 1 },
          }),
        }) as never,
      storeAsset: async () => "https://stub.local/queued.png",
      log: () => {},
    });
    worker.wake();
    await worker.idle();
    worker.stop();
    const card = await db.card.findUniqueOrThrow({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.in-use" } },
    });
    expect(card.outputs).toEqual(["https://stub.local/queued.png"]);
    const state = await queueRepo.projectGenerationState(maker.id, id);
    expect(state.jobs["etsy.in-use"].status).toBe("done");
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
