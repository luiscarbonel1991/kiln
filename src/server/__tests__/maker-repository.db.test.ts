import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("maker brand kit (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/maker-repository");
  const { importProductsAction } = await import("@/app/actions/products");

  it("importing a package with a maker block saves the brand kit", async () => {
    const result = await importProductsAction({
      maker: { palette: ["#2F4A3A"], handle: "@brandtest" },
      products: [
        {
          id: "brandtest:BT-01",
          sku: "BT-01",
          name: "Brand test mug",
          family: "Kitchen",
          dimensions: { w: 3, h: 4, unit: "in" },
          shape: "mug",
          material: "stoneware",
          treatment: "printed",
          colours: [{ key: "white", name: "White", face: "#FFFFFF" }],
          defaultColour: "white",
          typography: { family: "Hanken Grotesk" },
          source: { kind: "form" },
        },
      ],
    });
    expect(result).toMatchObject({ rejected: [], brandErrors: [] });
    expect(await repo.getMakerBrand()).toEqual({
      palette: ["#2F4A3A"],
      handle: "brandtest",
    });
  });

  it("importing a vector product measures its outline; a drawing off its dimensions is reported", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#D9B98C" stroke="#5B3A29" stroke-width="3"/></svg>`;
    const vector = (sku: string, w: number, h: number) => ({
      id: `outline:${sku}`,
      sku,
      name: "Outline test coaster",
      family: "Home",
      dimensions: { w, h, unit: "in" },
      shape: "round coaster",
      material: "birch",
      treatment: "engraved",
      colours: [{ key: "n", name: "Natural", face: "#D9B98C" }],
      defaultColour: "n",
      typography: { family: "Hanken Grotesk" },
      source: {
        kind: "vector",
        svgUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        // A package's own box is never kept.
        outlineBox: { x: 0, y: 0, w: 1, h: 1 },
      },
    });
    const result = await importProductsAction([
      vector("OT-01", 4, 4),
      vector("OT-02", 5, 3),
    ]);
    if ("error" in result) throw new Error(result.error);
    const [fits, off] = result.imported.map((i) => i.product);
    expect(fits.source).toMatchObject({
      outlineBox: { x: 0.025, y: 0.025, w: 0.95, h: 0.95 },
    });
    expect(off.source).not.toHaveProperty("outlineBox");
    expect(result.warnings).toEqual([
      expect.stringContaining(
        '"OT-02" Outline test coaster: its SVG\'s drawing is 1.00:1',
      ),
    ]);
    const maker = await repo.getCurrentMaker();
    await db.product.deleteMany({
      where: { makerId: maker.id, sku: { in: ["OT-01", "OT-02"] } },
    });
  });

  it("a stale brand row reads as none, never throws", async () => {
    const maker = await repo.getCurrentMaker();
    await db.maker.update({
      where: { id: maker.id },
      data: { brand: { palette: "not a list" } },
    });
    expect(await repo.getMakerBrand()).toBeNull();
    await db.maker.update({
      where: { id: maker.id },
      data: { brand: null as never },
    });
    await db.product.deleteMany({
      where: { makerId: maker.id, sku: "BT-01" },
    });
  });
});

describe.skipIf(!enabled)("maker models (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/maker-repository");
  const { DEFAULT_MAKER_MODELS } = await import("@/domain/model-defaults");
  let maker: { id: string };
  beforeAll(async () => {
    maker = await repo.getCurrentMaker();
  });

  afterAll(async () => {
    await db.$executeRaw`UPDATE "Maker" SET "models" = NULL WHERE "id" = ${maker.id}`;
  });

  it("reads Kiln's defaults until the maker saves their own", async () => {
    await db.$executeRaw`UPDATE "Maker" SET "models" = NULL WHERE "id" = ${maker.id}`;
    expect(await repo.getMakerModels()).toEqual(DEFAULT_MAKER_MODELS);
    const mine = {
      image: { provider: "google" as const, model: "gemini-3-pro-image" },
      video: {
        provider: "google" as const,
        model: "veo-3.1-lite-generate-preview",
        resolution: "1080p" as const,
      },
      text: { provider: "google" as const, model: "gemini-3.8-flash" },
    };
    await repo.saveMakerModels(mine);
    expect(await repo.getMakerModels()).toEqual(mine);
  });

  it("refuses a retired or unknown model, and reads a stale saved kind as the default", async () => {
    await expect(
      repo.saveMakerModels({
        ...DEFAULT_MAKER_MODELS,
        video: { provider: "openai", model: "sora-2" },
      }),
    ).rejects.toThrow(/Sora 2 was shut down/);
    await db.$executeRaw`UPDATE "Maker" SET "models" = ${JSON.stringify({
      image: { provider: "openai", model: "gpt-image-1.5", quality: "high" },
      video: { provider: "openai", model: "sora-2" },
    })}::jsonb WHERE "id" = ${maker.id}`;
    expect(await repo.getMakerModels()).toEqual({
      image: { provider: "openai", model: "gpt-image-1.5", quality: "high" },
      video: DEFAULT_MAKER_MODELS.video,
      text: DEFAULT_MAKER_MODELS.text,
    });
  });
});

describe.skipIf(!enabled)("maker preferences (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/maker-repository");
  let before: unknown = null;
  beforeAll(async () => {
    const maker = await repo.getCurrentMaker();
    before = (
      await db.maker.findUniqueOrThrow({
        where: { id: maker.id },
        select: { preferences: true },
      })
    ).preferences;
    await db.maker.update({
      where: { id: maker.id },
      data: { preferences: { other: "kept" } },
    });
  });
  afterAll(async () => {
    const maker = await repo.getCurrentMaker();
    await db.maker.update({
      where: { id: maker.id },
      data: { preferences: before ?? undefined },
    });
  });

  it("remembers the hero's setting per destination and family, two at once, keeping what else is there", async () => {
    await Promise.all([
      repo.rememberHeroSetting("etsy", "Home", "place"),
      repo.rememberHeroSetting("etsy", "Kitchen", "sweep"),
    ]);
    expect(await repo.getMakerPreferences()).toEqual({
      heroSetting: { "etsy:home": "place", "etsy:kitchen": "sweep" },
    });
    await repo.rememberHeroSetting("etsy", "home ", "sweep");
    const maker = await repo.getCurrentMaker();
    const row = await db.maker.findUniqueOrThrow({
      where: { id: maker.id },
      select: { preferences: true },
    });
    expect(row.preferences).toEqual({
      other: "kept",
      heroSetting: { "etsy:home": "sweep", "etsy:kitchen": "sweep" },
    });
  });
});
