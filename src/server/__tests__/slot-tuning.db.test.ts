import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: () => {} }));

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("a scene's knobs (database)", async () => {
  const maker = enabled
    ? await (await import("@/server/maker-repository")).getCurrentMaker()
    : { id: "" };
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { setSlotKnobAction, setSlotPlaceAction, updateProjectProductAction } =
    await import("@/app/actions/board");
  const { planProject } = await import("@/domain/plan");
  const { Product } = await import("@/domain/product");
  const { CATALOG } = await import("@/lib/recipes");
  const { photoReference, slotCards, startEditorState } = await import(
    "@/lib/project-start"
  );

  const stamp = Date.now();
  const onBase = (sku: string, source: unknown) =>
    Product.parse({
      id: `pkg:${sku}`,
      sku,
      name: "Tuning test plate",
      family: "Desk",
      dimensions: { w: 9, h: 2.78, d: 2.25, unit: "in" },
      shape: "name plate",
      material: "birch plywood",
      treatment: "engraved",
      colours: [{ key: "birch", name: "Birch", face: "#E3C9A0" }],
      defaultColour: "birch",
      typography: { family: "Fraunces" },
      useContexts: ["a desk beside a laptop"],
      parts: [
        { name: "plate", dimensions: { w: 8, h: 2.5, d: 0.14 } },
        { name: "base", lies: "flat", dimensions: { w: 9, h: 0.28, d: 2.25 } },
      ],
      source,
    });
  const photo = onBase(`TU-${stamp}`, {
    kind: "photo",
    assetUrl: "https://stub.local/plate.png",
  });
  const form = onBase(`TF-${stamp}`, { kind: "form" });
  const created: string[] = [];
  const inUse = { destinationId: "etsy", slotKey: "in-use" };
  const cardKey = (projectId: string) => ({
    projectId_cardId: { projectId, cardId: "etsy.in-use" },
  });

  afterAll(async () => {
    await db.generationJob.deleteMany({
      where: { projectId: { in: created } },
    });
    await db.project.deleteMany({ where: { id: { in: created } } });
    await db.product.deleteMany({
      where: { sku: { in: [photo.sku, form.sku] } },
    });
  });

  async function start(product: typeof photo, strip = false) {
    const [saved] = await upsertProducts(maker, [product]);
    const planned = planProject({
      product: saved,
      type: "listing-kit",
      destinationIds: ["etsy"],
      catalog: CATALOG,
    });
    const plan = strip
      ? {
          destinations: planned.destinations.map((d) => ({
            ...d,
            slots: d.slots.map(({ knobs: _k, ...s }) => s),
          })),
        }
      : planned;
    const editor = startEditorState({
      product: saved,
      type: "listing-kit",
      plan,
      master: photoReference(saved),
    });
    const id = await repo.createProject(maker, {
      type: "listing-kit",
      product: saved,
      plan,
      editor,
    });
    created.push(id);
    return { id, saved };
  }

  const tune = (projectId: string, choice: object) =>
    setSlotKnobAction({ projectId, ...inUse, choice });
  const card = (projectId: string) =>
    db.card.findUniqueOrThrow({ where: cardKey(projectId) });
  const slotOf = async (projectId: string) => {
    const row = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { plan: true },
    });
    const plan = row.plan as {
      destinations: { slots: { key: string; tuned?: object }[] }[];
    };
    return plan.destinations[0].slots.find((s) => s.key === "in-use");
  };
  const composition = async (projectId: string) =>
    ((await card(projectId)).fields as { composition: { value: string } })
      .composition.value;

  it("starts from the scene's default, a base lying flat or not", async () => {
    const { id } = await start(photo);
    expect(await composition(id)).toMatch(/^eye level or slightly above, /);
  });

  it("writes the plan and the card's direction, keeping what the maker wrote", async () => {
    const { id } = await start(photo);
    const before = (await card(id)).fields as Record<string, object>;
    await db.card.update({
      where: cardKey(id),
      data: {
        fields: {
          ...before,
          lighting: { value: "my own light", source: "local", locked: false },
        },
      },
    });
    expect(await tune(id, { knob: "camera", stop: "above" })).toBeUndefined();
    expect((await slotOf(id))?.tuned).toEqual({ camera: "above" });
    const after = (await card(id)).fields as Record<
      string,
      { value: string; source: string }
    >;
    expect(after.composition.value).toMatch(/^the camera a little above, /);
    expect(after.lighting).toEqual({
      value: "my own light",
      source: "local",
      locked: false,
    });
    expect(after.subject).toEqual(before.subject);

    expect(await tune(id, { knob: "distance", stop: "close" })).toBeUndefined();
    expect((await slotOf(id))?.tuned).toEqual({
      camera: "above",
      distance: "close",
    });
    expect(await composition(id)).toMatch(
      /^the camera a little above, .*, the product sharp and unmistakably the hero, framed close, filling most of the frame; /,
    );
  });

  it("refuses while the scene is in the queue or approved", async () => {
    const { id } = await start(photo);
    const maker = await getCurrentMaker();
    const job = await db.generationJob.create({
      data: {
        makerId: maker.id,
        projectId: id,
        cardId: "etsy.in-use",
        mode: "live",
        status: "queued",
        maxAttempts: 2,
        estimateMicros: 70_000,
      },
    });
    expect(await tune(id, { knob: "camera", stop: "eye" })).toEqual({
      error: "This scene is in the queue; tune it when it is done.",
    });
    await db.generationJob.delete({ where: { id: job.id } });

    await db.card.update({
      where: cardKey(id),
      data: { outputs: ["https://stub.local/take-1.png"], status: "done" },
    });
    await repo.setSlotApproval(maker, id, inUse, true);
    expect(await tune(id, { knob: "camera", stop: "eye" })).toEqual({
      error: "Undo the approval to tune this scene.",
    });
    await repo.setSlotApproval(maker, id, inUse, false);
    expect(await tune(id, { knob: "camera", stop: "eye" })).toBeUndefined();
  });

  it("without a reference only the plan changes; the reference brings the knobs", async () => {
    const { id, saved } = await start(form);
    expect(await db.card.count({ where: { projectId: id } })).toBe(0);
    expect(
      await tune(id, { knob: "camera", stop: "overhead" }),
    ).toBeUndefined();
    const loaded = await repo.loadProjectBoard(maker, id);
    const plan = loaded?.board.plan;
    if (!plan) throw new Error("no plan");
    const master = {
      id: `m-${stamp}`,
      origin: "product" as const,
      sourcePrompt: null,
      assetUrl: "https://stub.local/plate-reference.png",
      mime: "image/png",
    };
    await repo.setProjectReference(
      maker,
      id,
      master,
      slotCards(plan, master, saved),
    );
    expect(await composition(id)).toMatch(/^the camera high above/);
  });

  it("the hero's setting chosen on the board is remembered for the family, with or without a reference", async () => {
    const { getMakerPreferences } = await import("@/server/maker-repository");
    const maker = await getCurrentMaker();
    try {
      for (const product of [form, photo]) {
        const { id } = await start(product);
        for (const stop of ["place", "sweep"] as const) {
          expect(
            await setSlotKnobAction({
              projectId: id,
              destinationId: "etsy",
              slotKey: "hero",
              choice: { knob: "setting", stop },
            }),
          ).toBeUndefined();
          expect(
            (await getMakerPreferences(maker)).heroSetting["etsy:desk"],
          ).toBe(stop);
        }
      }
    } finally {
      // Only this test's key: other files write the same row in parallel.
      await db.$executeRaw`UPDATE "Maker" SET "preferences" = "preferences" #- '{heroSetting,etsy:desk}' WHERE "id" = ${maker.id}`;
    }
  });

  it("a scene given its own place stands there; a hero stands in it, remembered for the family", async () => {
    const { getMakerPreferences } = await import("@/server/maker-repository");
    const maker = await getCurrentMaker();
    const { id } = await start(photo);
    const scene = async (cardId: string) =>
      (
        (
          await db.card.findUniqueOrThrow({
            where: { projectId_cardId: { projectId: id, cardId } },
          })
        ).fields as { scene: { value: string } }
      ).scene.value;
    try {
      expect(
        await setSlotPlaceAction({
          projectId: id,
          ...inUse,
          place: "a reception counter, facing the visitor",
        }),
      ).toBeUndefined();
      expect(await scene("etsy.in-use")).toContain(
        "a reception counter, facing the visitor",
      );
      expect(
        await setSlotPlaceAction({ projectId: id, ...inUse, place: null }),
      ).toBeUndefined();
      expect(await scene("etsy.in-use")).toContain("a desk beside a laptop");
      expect(
        await setSlotPlaceAction({
          projectId: id,
          destinationId: "etsy",
          slotKey: "hero",
          place: "an oak bookshelf",
        }),
      ).toBeUndefined();
      expect(await scene("etsy.hero")).toContain(
        "in its place (an oak bookshelf)",
      );
      expect((await getMakerPreferences(maker)).heroSetting["etsy:desk"]).toBe(
        "place",
      );
      expect(
        await setSlotPlaceAction({
          projectId: id,
          destinationId: "etsy",
          slotKey: "size",
          place: "a desk",
        }),
      ).toEqual({ error: "not a scene slot" });
    } finally {
      await db.$executeRaw`UPDATE "Maker" SET "preferences" = "preferences" #- '{heroSetting,etsy:desk}' WHERE "id" = ${maker.id}`;
    }
  });

  it("follows the product version the project has; Update the project keeps the knobs", async () => {
    const { id, saved } = await start(photo);
    await upsertProducts(maker, [
      { ...saved, dimensions: { ...saved.dimensions, w: 11 } },
    ]);
    expect(await tune(id, { knob: "props", stop: "none" })).toBeUndefined();
    expect(await composition(id)).toContain("9 x 2.78 in");
    expect(await updateProjectProductAction({ projectId: id })).toBeUndefined();
    const after = await composition(id);
    expect(after).toContain("11 x 2.78 in");
    const scene = ((await card(id)).fields as { scene: { value: string } })
      .scene.value;
    expect(scene).toContain("no props beyond the place itself");
  });

  it("a scene planned before knobs is refused", async () => {
    const { id } = await start(photo, true);
    expect(await tune(id, { knob: "camera", stop: "eye" })).toEqual({
      error: "this scene was planned before knobs",
    });
  });
});
