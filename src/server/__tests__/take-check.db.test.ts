import { Resvg } from "@resvg/resvg-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Checking a frame's shown take again, against a throwaway Postgres (see
// project-repository.db.test.ts). The OCR is this machine's business: here
// there is none, so the check is said, written and read back unchecked.
vi.mock("@/server/qc/ocr", () => ({
  ocrEngine: async () => ({ none: "no OCR engine on this machine" }),
}));

const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

const png = (fill: string) =>
  `data:image/png;base64,${Buffer.from(
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`,
    )
      .render()
      .asPng(),
  ).toString("base64")}`;

describe.skipIf(!enabled)("take check (database)", async () => {
  const { db } = await import("@/lib/db");
  const { upsertProducts } = await import("@/server/product-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { recheckTake } = await import("@/server/qc/project-take");
  const { outputFacts } = await import("@/server/generation-repository");
  const { projectFrames } = await import("@/server/project-frames");
  const { Product } = await import("@/domain/product");

  const product = Product.parse({
    id: "pkg:QC-01",
    sku: `QC-${Date.now()}`,
    name: "Check test plate",
    family: "Desk",
    dimensions: { w: 10, h: 6, unit: "in" },
    shape: "plate",
    material: "hardwood",
    treatment: "engraved",
    colours: [{ key: "oak", name: "Oak", face: "#C8A165" }],
    defaultColour: "oak",
    typography: { family: "Fraunces" },
    wording: [{ label: "Number", maxChars: 6, example: "205" }],
    source: { kind: "form" },
  });
  const take = png("#c8a165");
  const reference = png("#f0eee9");
  let projectId = "";
  let jobId = "";

  beforeAll(async () => {
    const maker = await getCurrentMaker();
    const [saved] = await upsertProducts([product]);
    const project = await db.project.create({
      data: {
        makerId: maker.id,
        name: "Check test",
        type: "listing-kit",
        phase: "generation",
        plan: {
          destinations: [
            {
              destinationId: "etsy",
              shotListId: "etsy-listing",
              slots: ["hero", "in-use", "gift"].map((key) => ({
                key,
                label: key,
                purpose: key,
                fill: "scene",
              })),
            },
          ],
        },
        products: { create: { productId: saved.id, productSnapshot: saved } },
      },
    });
    projectId = project.id;
    const card = (cardId: string, outputs: string[]) => ({
      projectId,
      cardId,
      masterAssetId: "m",
      recipeId: "etsy-listing@etsy",
      type: "image",
      direction: cardId,
      fields: {},
      references: [],
      model: {},
      outputs,
      status: outputs.length ? "done" : "draft",
      sortOrder: 0,
    });
    await db.card.createMany({
      data: [
        card("etsy.hero", [take]),
        card("etsy.in-use", []),
        card("etsy.gift", [png("#123456")]),
      ],
    });
    const job = await db.generationJob.create({
      data: {
        makerId: maker.id,
        projectId,
        cardId: "etsy.hero",
        mode: "mock",
        status: "done",
        maxAttempts: 2,
        estimateMicros: 0,
        outputUrl: take,
        request: {
          kind: "image",
          masterAssetUrl: reference,
          prompt:
            "Composition: centered; the product true to its real size: 10 x 6 in, about 1/3 as wide as the door; never enlarged.",
          imageInputs: [],
          negative: "",
          model: {
            provider: "openai",
            model: "gpt-image-2",
            aspect: "1:1",
            guidance: 7.5,
            strength: 0.65,
          },
        },
      },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    await db.generationJob.deleteMany({ where: { projectId } });
    await db.project.deleteMany({ where: { id: projectId } });
    await db.product.deleteMany({ where: { sku: product.sku } });
  });

  it("checks the shown take again and writes it on the job that made it", async () => {
    const check = await recheckTake(projectId, {
      destinationId: "etsy",
      slotKey: "hero",
    });
    expect(check).toMatchObject({
      status: "unchecked",
      unchecked: "no OCR engine on this machine",
      scale: "10 x 6 in, about 1/3 as wide as the door",
    });
    const job = await db.generationJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(job.takeCheck).toEqual(check);
    const facts = await outputFacts(projectId, [take]);
    expect(facts.get(take)?.check).toEqual(check);
    // What get_frames and view_frame read.
    const frames = await projectFrames(projectId);
    const hero = frames?.frames.find((f) => f.frame === "etsy.hero");
    expect(hero?.check).toEqual({
      status: "unchecked",
      problems: [],
      notes: [],
      scale: "10 x 6 in, about 1/3 as wide as the door",
      unchecked: "no OCR engine on this machine",
    });
  });

  it("refuses a frame with no take, and a take no job of Kiln's made", async () => {
    await expect(
      recheckTake(projectId, { destinationId: "etsy", slotKey: "in-use" }),
    ).rejects.toThrow("That frame has no take to check.");
    await expect(
      recheckTake(projectId, { destinationId: "etsy", slotKey: "gift" }),
    ).rejects.toThrow(/no record of how this take was made/);
  });
});
