import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("maker brand kit (database)", async () => {
  const maker = enabled
    ? await (await import("@/server/maker-repository")).getCurrentMaker()
    : { id: "" };
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
    expect(await repo.getMakerBrand(maker)).toEqual({
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
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#D9B98C"/></svg>`;
    const styled = {
      ...vector("OT-03", 4, 4),
      styles: [
        { key: "ring", name: "Ring", svgUrl: vector("x", 1, 1).source.svgUrl },
        {
          key: "wide",
          name: "Wide",
          svgUrl: `data:image/svg+xml;base64,${Buffer.from(wide).toString("base64")}`,
          outlineBox: { x: 0, y: 0, w: 1, h: 1 },
        },
      ],
    };
    const result = await importProductsAction([
      vector("OT-01", 4, 4),
      vector("OT-02", 5, 3),
      styled,
    ]);
    if ("error" in result) throw new Error(result.error);
    const [fits, off, withStyles] = result.imported.map((i) => i.product);
    expect(fits.source).toMatchObject({
      outlineBox: { x: 0.025, y: 0.025, w: 0.95, h: 0.95 },
    });
    expect(off.source).not.toHaveProperty("outlineBox");
    // Each style's outline is measured too, never taken from the package.
    expect(withStyles.styles?.[0].outlineBox).toEqual({
      x: 0.025,
      y: 0.025,
      w: 0.95,
      h: 0.95,
    });
    expect(withStyles.styles?.[1]).not.toHaveProperty("outlineBox");
    expect(result.warnings).toEqual([
      expect.stringContaining(
        '"OT-02" Outline test coaster: its SVG\'s drawing is 1.00:1',
      ),
      expect.stringContaining(
        '"OT-03" Outline test coaster: the Wide style: its SVG\'s drawing is 2.00:1',
      ),
    ]);
    const maker = await repo.getCurrentMaker();
    await db.product.deleteMany({
      where: { makerId: maker.id, sku: { in: ["OT-01", "OT-02", "OT-03"] } },
    });
  });

  it("a stale brand row reads as none, never throws", async () => {
    const maker = await repo.getCurrentMaker();
    await db.maker.update({
      where: { id: maker.id },
      data: { brand: { palette: "not a list" } },
    });
    expect(await repo.getMakerBrand(maker)).toBeNull();
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
  const { proposeRoutes } = await import("@/domain/model-routing");
  let maker: { id: string };
  beforeAll(async () => {
    maker = await repo.getCurrentMaker();
  });

  afterAll(async () => {
    await db.$executeRaw`UPDATE "Maker" SET "models" = NULL WHERE "id" = ${maker.id}`;
  });

  it("reads Kiln's defaults and no routes until the maker saves them", async () => {
    await db.$executeRaw`UPDATE "Maker" SET "models" = NULL WHERE "id" = ${maker.id}`;
    expect(await repo.getMakerModelSetup(maker)).toEqual({
      models: DEFAULT_MAKER_MODELS,
      routes: null,
      agents: {},
    });
  });

  it("saves the routes, and their heads become the defaults", async () => {
    const routes = proposeRoutes(DEFAULT_MAKER_MODELS, {
      openai: true,
      google: true,
    });
    const flash = { provider: "google" as const, model: "gemini-3.8-flash" };
    const mine = {
      ...routes,
      deep: { models: [flash, routes.deep.models[0]], fallback: true },
      // What does not price a kind is not kept.
      final: {
        models: [
          {
            provider: "google" as const,
            model: "gemini-3-pro-image",
            quality: "high" as const,
          },
        ],
        fallback: true,
      },
    };
    await repo.saveMakerRoutes(maker, mine);
    const setup = await repo.getMakerModelSetup(maker);
    expect(setup.routes?.deep.models).toEqual(mine.deep.models);
    expect(setup.routes?.final.models).toEqual([
      { provider: "google", model: "gemini-3-pro-image" },
    ]);
    expect(setup.models).toEqual({
      image: { provider: "google", model: "gemini-3-pro-image" },
      video: routes.video.models[0],
      text: flash,
    });
  });

  it("keeps a text route's effort and the agents' own routes", async () => {
    const routes = proposeRoutes(DEFAULT_MAKER_MODELS, {
      openai: true,
      google: true,
    });
    const astra = { provider: "openai" as const, model: "gpt-6-astra" };
    await repo.saveMakerRoutes(
      maker,
      { ...routes, deep: { ...routes.deep, effort: "xhigh" } },
      { etsy: { models: [astra], fallback: false, effort: "max" } },
    );
    const setup = await repo.getMakerModelSetup(maker);
    expect(setup.routes?.deep.effort).toBe("xhigh");
    expect(setup.routes?.fast.effort).toBeUndefined();
    expect(setup.agents).toEqual({
      etsy: { models: [astra], fallback: false, effort: "max" },
    });
    await expect(
      repo.saveMakerRoutes(maker, routes, {
        etsy: {
          models: [{ provider: "openai", model: "gpt-image-2" }],
          fallback: false,
        },
      }),
    ).rejects.toThrow(/not a text model/);
  });

  it("refuses a retired model or a repeat, and reads a stale saved kind as the default", async () => {
    const routes = proposeRoutes(DEFAULT_MAKER_MODELS, {
      openai: true,
      google: true,
    });
    await expect(
      repo.saveMakerRoutes(maker, {
        ...routes,
        video: {
          models: [{ provider: "openai", model: "sora-2" }],
          fallback: false,
        },
      }),
    ).rejects.toThrow(/Sora 2 was shut down/);
    await expect(
      repo.saveMakerRoutes(maker, {
        ...routes,
        fast: {
          models: [routes.fast.models[0], routes.fast.models[0]],
          fallback: true,
        },
      }),
    ).rejects.toThrow(/twice/);
    await db.$executeRaw`UPDATE "Maker" SET "models" = ${JSON.stringify({
      image: { provider: "openai", model: "gpt-image-1.5", quality: "high" },
      video: { provider: "openai", model: "sora-2" },
    })}::jsonb WHERE "id" = ${maker.id}`;
    expect(await repo.getMakerModels(maker)).toEqual({
      image: { provider: "openai", model: "gpt-image-1.5", quality: "high" },
      video: DEFAULT_MAKER_MODELS.video,
      text: DEFAULT_MAKER_MODELS.text,
    });
  });
});

// The maker's preferences are one row other test files write too, in
// parallel: each test adds and removes only its own keys, in one statement.
describe.skipIf(!enabled)("maker preferences (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/maker-repository");
  beforeAll(async () => {
    const maker = await repo.getCurrentMaker();
    await db.$executeRaw`UPDATE "Maker" SET "preferences" = COALESCE("preferences", '{}'::jsonb) || '{"other":"kept"}'::jsonb WHERE "id" = ${maker.id}`;
  });
  afterAll(async () => {
    const maker = await repo.getCurrentMaker();
    await db.$executeRaw`UPDATE "Maker" SET "preferences" = "preferences" - 'other' #- '{heroSetting,etsy:home}' #- '{heroSetting,etsy:kitchen}' WHERE "id" = ${maker.id}`;
  });

  it("remembers the hero's setting per destination and family, two at once, keeping what else is there", async () => {
    const maker = await repo.getCurrentMaker();
    await Promise.all([
      repo.rememberHeroSetting(maker, "etsy", "Home", "place"),
      repo.rememberHeroSetting(maker, "etsy", "Kitchen", "sweep"),
    ]);
    expect((await repo.getMakerPreferences(maker)).heroSetting).toMatchObject({
      "etsy:home": "place",
      "etsy:kitchen": "sweep",
    });
    await repo.rememberHeroSetting(maker, "etsy", "home ", "sweep");
    const row = await db.maker.findUniqueOrThrow({
      where: { id: maker.id },
      select: { preferences: true },
    });
    expect(row.preferences).toMatchObject({
      other: "kept",
      heroSetting: { "etsy:home": "sweep", "etsy:kitchen": "sweep" },
    });
  });
});
