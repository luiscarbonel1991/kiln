import { describe, expect, it } from "vitest";

// Integration test against the throwaway Postgres (see
// src/server/__tests__/project-repository.db.test.ts for the setup).
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("laser pricing settings (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/modules/laser-pricing/repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { DEFAULT_SHOP } = await import("@/modules/laser-pricing/presets");

  it("saves and reads the calculator defaults in the module's own row", async () => {
    const data = {
      machineName: "CO2 40W",
      materialName: "MDF 3mm",
      shop: DEFAULT_SHOP,
    };
    await repo.saveMakerPricing(data);
    await repo.saveMakerPricing({ ...data, materialName: "Birch ply 3mm" });
    expect(await repo.getMakerPricing()).toEqual({
      ...data,
      materialName: "Birch ply 3mm",
    });
    const maker = await getCurrentMaker();
    const rows = await db.moduleSettings.findMany({
      where: { makerId: maker.id },
    });
    expect(rows.map((r) => r.module)).toEqual(["laser-pricing"]);
  });

  it("a stale row reads as none, never throws", async () => {
    const maker = await getCurrentMaker();
    await db.moduleSettings.update({
      where: {
        makerId_module: { makerId: maker.id, module: "laser-pricing" },
      },
      data: { settings: { machineName: 42 } },
    });
    expect(await repo.getMakerPricing()).toBeNull();
    await db.moduleSettings.delete({
      where: {
        makerId_module: { makerId: maker.id, module: "laser-pricing" },
      },
    });
  });
});
