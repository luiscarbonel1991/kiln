import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A project's frames as the API reads them, and an approval that names the
// take it checked (the throwaway Postgres: see project-repository.db.test.ts).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("project frames (database)", async () => {
  const maker = enabled
    ? await (await import("@/server/maker-repository")).getCurrentMaker()
    : { id: "" };
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { framedProjects, projectFrames, waitingProjectFrames } = await import(
    "@/server/project-frames"
  );
  const { upsertProducts } = await import("@/server/product-repository");
  const { planProject, SlotRefusal } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, startEditorState } = await import(
    "@/lib/project-start"
  );

  const sku = `FR-${Date.now()}`;
  const created: string[] = [];
  afterAll(async () => {
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({ where: { sku } });
  });

  it("lists the frames, approves only the take that was checked, and withdraws", async () => {
    const [product] = await upsertProducts(maker, [
      Product.parse({
        id: "pkg:FR",
        sku,
        name: "Frames test coaster",
        family: "Kitchen",
        dimensions: { w: 4, h: 4, unit: "in" },
        shape: "round coaster",
        material: "cork",
        treatment: "engraved",
        colours: [{ key: "cork", name: "Cork", face: "#C9A27A" }],
        defaultColour: "cork",
        typography: { family: "Fraunces" },
        source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
      }),
    ]);
    const master = photoReference(product);
    if (!master) throw new Error("no reference");
    const plan = planProject({
      product,
      type: "listing-kit",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const id = await repo.createProject(maker, {
      type: "listing-kit",
      product,
      plan,
      editor: startEditorState({ product, type: "listing-kit", plan, master }),
    });
    created.push(id);
    const hero = { destinationId: "etsy", slotKey: "hero" };

    // Nothing generated yet: every scene with a card waits for a batch, and
    // the hero takes no approval.
    const state = await waitingProjectFrames(maker, id);
    expect(state?.reference).toBe(true);
    const waiting = state?.waiting;
    expect(waiting).toContain("etsy.hero");
    expect(
      waiting?.every((frame) =>
        plan.destinations.some((d) =>
          d.slots.some(
            (s) =>
              `${d.destinationId}.${s.key}` === frame && s.fill === "scene",
          ),
        ),
      ),
    ).toBe(true);
    let frames = await projectFrames(maker, id);
    expect(frames?.project).toMatchObject({ id, type: "listing-kit" });
    expect(frames?.frames.find((f) => f.frame === "etsy.hero")).toMatchObject({
      state: "queued",
      output: null,
      approvable: false,
    });
    await expect(
      repo.setSlotApproval(maker, id, hero, true),
    ).rejects.toMatchObject({
      kind: "refused",
    });

    const first = "https://stub.local/hero-1.png";
    const second = "https://stub.local/hero-2.png";
    await db.card.update({
      where: { projectId_cardId: { projectId: id, cardId: "etsy.hero" } },
      data: { outputs: [second, first], status: "done" },
    });
    frames = await projectFrames(maker, id);
    expect(frames?.frames.find((f) => f.frame === "etsy.hero")).toMatchObject({
      state: "to-review",
      output: second,
      approvable: true,
    });

    // The caller checked the first take; the second landed since.
    const stale = repo.setSlotApproval(maker, id, hero, true, first);
    await expect(stale).rejects.toBeInstanceOf(SlotRefusal);
    await expect(stale).rejects.toMatchObject({ kind: "stale" });

    await repo.setSlotApproval(maker, id, hero, true, second);
    frames = await projectFrames(maker, id);
    expect(frames?.frames.find((f) => f.frame === "etsy.hero")).toMatchObject({
      state: "approved",
      approvedOutput: second,
    });

    await repo.setSlotApproval(maker, id, hero, false);
    frames = await projectFrames(maker, id);
    expect(frames?.frames.find((f) => f.frame === "etsy.hero")).toMatchObject({
      state: "to-review",
      approvedOutput: null,
    });

    await expect(
      repo.setSlotApproval(
        maker,
        id,
        { destinationId: "etsy", slotKey: "nope" },
        true,
      ),
    ).rejects.toMatchObject({ kind: "missing" });
    expect((await framedProjects(maker)).map((p) => p.id)).toContain(id);
    expect(await projectFrames(maker, "no-such-project")).toBeNull();
    expect(await waitingProjectFrames(maker, "no-such-project")).toBeNull();
  });
});

// A frame's failure reaches each reader of the frame in their words: the
// poll's state and the frame tools read it through projectGenerationState,
// which maps what only the owner can act on for a member. The owner and a
// token read it as stored. Its own studio, with Ana (owner), Bob and Carla.
describe.skipIf(!enabled)(
  "a frame's failure, by who reads it (database)",
  async () => {
    const { db } = await import("@/lib/db");
    const fx = await import("@/server/__tests__/fixtures/studio-keys");
    const repo = await import("@/server/project-repository");
    const { projectFrames } = await import("@/server/project-frames");
    const { projectGenerationState } = await import(
      "@/server/generation-repository"
    );
    const { upsertProducts } = await import("@/server/product-repository");
    const { planProject } = await import("@/domain/plan");
    const { Product } = await import("@/domain/product");
    const { CATALOG } = await import("@/lib/recipes");
    const { photoReference, startEditorState } = await import(
      "@/lib/project-start"
    );

    const REJECTED =
      "OpenAI rejected the API key — replace the key or use Google.";
    const LEFT =
      "Not run: the person who queued it is no longer on the team, so nothing was spent.";
    const sku = `FR-READ-${Date.now()}`;
    let studio: Awaited<ReturnType<typeof fx.openStudio>>;
    let projectId = "";

    beforeAll(async () => {
      studio = await fx.openStudio("frames-read");
      const owner = studio.as(studio.ana);
      const [product] = await upsertProducts(owner, [
        Product.parse({
          id: "pkg:FR-READ",
          sku,
          name: "Frames reader piece",
          family: "Home",
          dimensions: { w: 4, h: 4, unit: "in" },
          shape: "round",
          material: "paper",
          treatment: "printed",
          colours: [{ key: "sand", name: "Sand", face: "#C9A27A" }],
          defaultColour: "sand",
          typography: { family: "Fraunces" },
          source: { kind: "photo", assetUrl: "https://stub.local/front.png" },
        }),
      ]);
      const master = photoReference(product);
      if (!master) throw new Error("no reference");
      const plan = planProject({
        product,
        type: "listing-kit",
        destinationIds: ["etsy"],
        catalog: CATALOG,
      });
      projectId = await repo.createProject(owner, {
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
      const batch = await db.generationBatch.create({
        data: {
          makerId: studio.makerId,
          projectId,
          mode: "live",
          count: 2,
          estimateMicros: 2,
          model: "gpt-image-2",
        },
      });
      const failed = (cardId: string, error: string) => ({
        batchId: batch.id,
        makerId: studio.makerId,
        projectId,
        cardId,
        mode: "live",
        status: "failed",
        attempt: 1,
        maxAttempts: 2,
        estimateMicros: 1,
        request: fx.imageRequest("openai", cardId),
        error,
        finishedAt: new Date(),
      });
      await db.generationJob.createMany({
        data: [failed("etsy.hero", REJECTED), failed("etsy.in-use", LEFT)],
      });
    });

    afterAll(async () => {
      // The product holds on to its maker: it goes after its project and
      // before the maker.
      await db.project.deleteMany({ where: { makerId: studio?.makerId } });
      await db.product.deleteMany({ where: { sku } });
      await fx.closeStudio(studio);
    });

    it("a member's poll reads a rejected key in their words, with no way to replace it", async () => {
      const state = await projectGenerationState(
        studio.as(studio.bob),
        projectId,
      );
      expect(state.jobs["etsy.hero"].error).toBe(
        "OpenAI rejected the studio's key on its last call; ask Ana.",
      );
      expect(JSON.stringify(state)).not.toMatch(/replace/i);
    });

    it("the owner's poll and a token's read it as stored", async () => {
      for (const reader of [studio.as(studio.ana), studio.as()]) {
        const state = await projectGenerationState(reader, projectId);
        expect(state.jobs["etsy.hero"].error).toBe(REJECTED);
      }
    });

    it("the frame tools read it in each reader's words too", async () => {
      const member = JSON.stringify(
        await projectFrames(studio.as(studio.carla), projectId),
      );
      expect(member).toContain(
        "OpenAI rejected the studio's key on its last call; ask Ana.",
      );
      expect(member).not.toMatch(/replace/i);
      for (const reader of [studio.as(studio.ana), studio.as()]) {
        expect(
          JSON.stringify(await projectFrames(reader, projectId)),
        ).toContain(REJECTED);
      }
    });

    it("a job that did not run because its starter left reads the same for everyone", async () => {
      for (const reader of [
        studio.as(studio.ana),
        studio.as(studio.bob),
        studio.as(),
      ]) {
        const state = await projectGenerationState(reader, projectId);
        expect(state.jobs["etsy.in-use"].error).toBe(LEFT);
      }
    });
  },
);
