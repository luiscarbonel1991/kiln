import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A design project against the throwaway Postgres (see
// project-repository.db.test.ts for the setup): the tools' read of its
// drawings, the server's vector, the queue drawing it, and the studio's
// autosave keeping what the server wrote since the editor read the cards.
const keys = vi.hoisted(() => ({ present: true }));
vi.mock("@/providers/keys", () => ({ hasProviderKey: () => keys.present }));

const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("a design (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const designs = await import("@/server/designs");
  const { getCurrentMaker } = await import("@/server/maker-repository");

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
  const drawing = (i: number, direction: string, outputs: string[]) => ({
    id: `recipe-line-art-${i}`,
    parentId: null,
    masterAssetId: "m-1",
    recipeId: "recipe-line-art",
    type: "image" as const,
    direction,
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
    status: outputs.length ? ("done" as const) : ("draft" as const),
  });
  const editor = {
    name: "DB test design",
    phase: "generation" as const,
    master: {
      id: "m-1",
      origin: "upload" as const,
      sourcePrompt: null,
      assetUrl: "https://stub.local/fern.png",
      mime: "image/png",
    },
    understanding: {
      subject: "a fern leaf",
      productType: "",
      useContext: "",
      sceneProps: "",
      avoid: "",
      materials: "ink",
      lighting: "flat",
      composition: "centered",
      mood: "calm",
      palette: ["#000000"],
    },
    recipeId: "recipe-line-art",
    planning: null,
    cards: [
      drawing(0, "Outline", ["https://stub.local/outline.png"]),
      drawing(1, "Detail", []),
      drawing(2, "Badge", []),
    ],
  };
  let id: string;
  let other: string;
  const card = (cardId: string) =>
    db.card.findUniqueOrThrow({
      where: { projectId_cardId: { projectId: id, cardId } },
    });

  beforeAll(async () => {
    id = await repo.saveProject(editor);
    other = await repo.saveProject({
      ...editor,
      name: "DB test studio",
      recipeId: "recipe-etsy-hero",
    });
  });

  afterAll(async () => {
    await db.generationJob.deleteMany({
      where: { projectId: { in: [id, other] } },
    });
    await db.generationBatch.deleteMany({
      where: { projectId: { in: [id, other] } },
    });
    await db.project.deleteMany({ where: { id: { in: [id, other] } } });
  });

  it("is listed and read as a design, with each drawing's state", async () => {
    expect(await designs.isDesign(id)).toBe(true);
    expect(await designs.isDesign(other)).toBe(false);
    const listed = (await designs.listDesigns()).find((d) => d.id === id);
    expect(listed).toMatchObject({ drawings: 3, drawn: 1, vectorized: 0 });
    const view = await designs.designView(id);
    expect(view).toMatchObject({
      master: "https://stub.local/fern.png",
      subject: "a fern leaf",
      drawings: [
        {
          card: "recipe-line-art-0",
          label: "Outline",
          state: "drawn",
          lineArt: "https://stub.local/outline.png",
        },
        { label: "Detail", state: "to-draw" },
        { label: "Badge", state: "to-draw" },
      ],
    });
    expect(await designs.designView(other)).toBeNull();
  });

  it("keeps a vector traced on the server only for the take it traced", async () => {
    expect(
      await repo.setCardVector(
        id,
        "recipe-line-art-0",
        "https://stub.local/older.png",
        "https://stub.local/wrong.svg",
      ),
    ).toBe(false);
    expect(
      await repo.setCardVector(
        id,
        "recipe-line-art-0",
        "https://stub.local/outline.png",
        "https://stub.local/outline.svg",
      ),
    ).toBe(true);
    expect((await card("recipe-line-art-0")).vectorUrl).toBe(
      "https://stub.local/outline.svg",
    );
    const view = await designs.designView(id);
    expect(view?.drawings[0]).toMatchObject({
      state: "vectorized",
      makeProduct: `/projects/new?design=${encodeURIComponent("https://stub.local/outline.svg")}`,
    });
  });

  it("a stale editor's autosave keeps the server's take and vector, and the editor's own edits", async () => {
    // The queue drew Detail since the editor read the cards.
    await db.card.update({
      where: {
        projectId_cardId: { projectId: id, cardId: "recipe-line-art-1" },
      },
      data: {
        outputs: ["https://stub.local/detail.png"],
        status: "done",
        vectorUrl: null,
      },
    });
    // The stale tab: Outline without the server's vector, Detail without
    // its take, a prompt of its own on Badge.
    await repo.saveProject(
      {
        ...editor,
        cards: [
          editor.cards[0],
          editor.cards[1],
          { ...editor.cards[2], promptOverride: "bolder lines" },
        ],
      },
      id,
    );
    expect(await card("recipe-line-art-0")).toMatchObject({
      outputs: ["https://stub.local/outline.png"],
      vectorUrl: "https://stub.local/outline.svg",
    });
    expect(await card("recipe-line-art-1")).toMatchObject({
      outputs: ["https://stub.local/detail.png"],
      status: "done",
    });
    expect((await card("recipe-line-art-2")).promptOverride).toBe(
      "bolder lines",
    );
    // An editor that drew Outline again itself: its take wins, the old
    // vector goes with the old take.
    await repo.saveCardOutput(
      id,
      "recipe-line-art-0",
      "https://stub.local/outline-2.png",
    );
    await repo.saveProject(
      {
        ...editor,
        cards: [
          drawing(0, "Outline", ["https://stub.local/outline-2.png"]),
          editor.cards[1],
        ],
      },
      id,
    );
    expect(await card("recipe-line-art-0")).toMatchObject({
      outputs: ["https://stub.local/outline-2.png"],
      vectorUrl: null,
    });
    // The editor still owns the card set: Badge was removed.
    expect(
      await db.card.count({
        where: { projectId: id, cardId: "recipe-line-art-2" },
      }),
    ).toBe(0);
  });

  it("is drawn through the queue, and a studio project that is not a design is not", async () => {
    const { enqueueProjectCards } = await import("@/server/generation-queue");
    await expect(
      enqueueProjectCards({ projectId: other, cardIds: ["recipe-line-art-0"] }),
    ).rejects.toThrow("Only a planned project or a design");
    const queued = await enqueueProjectCards({
      projectId: id,
      cardIds: ["recipe-line-art-1"],
    });
    expect(queued.queued).toBe(1);
    const job = await db.generationJob.findFirstOrThrow({
      where: { projectId: id, cardId: "recipe-line-art-1" },
    });
    expect(job.request).toMatchObject({
      kind: "image",
      masterAssetUrl: "https://stub.local/fern.png",
    });
    expect((await designs.designView(id))?.drawings[1].state).toBe("drawing");
    // Nothing runs it here: cancel it, as the maker's Stop does.
    await db.generationJob.updateMany({
      where: { projectId: id, status: { in: ["queued", "running"] } },
      data: { status: "canceled", finishedAt: new Date() },
    });
  });

  it("says a design's batch ended in its drawings' words", async () => {
    const { batchWords } = await import("@/server/batch-end");
    const ended = {
      projectId: id,
      design: true,
      count: 2,
      done: 2,
      failed: 0,
      canceled: 0,
    };
    expect(batchWords(ended)).toBe(
      "All 2 drawings of the last batch landed: they wait in the studio, to vectorize.",
    );
    expect(batchWords({ ...ended, done: 1, failed: 1 })).toBe(
      "1 of 2 drawings of the last batch landed, 1 failed.",
    );
    const maker = await getCurrentMaker();
    const batch = await db.generationBatch.create({
      data: {
        makerId: maker.id,
        projectId: id,
        mode: "mock",
        count: 1,
        estimateMicros: 1,
        model: "gpt-image-2",
      },
    });
    const { finishBatch } = await import("@/server/batch-end");
    expect(await finishBatch(batch.id)).toMatchObject({
      projectId: id,
      design: true,
    });
  });
});
