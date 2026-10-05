import { describe, expect, it } from "vitest";
import { DEFAULT_SHOP } from "@/modules/laser-pricing/presets";
import { MakerProfileData } from "@/modules/laser-pricing/types";

describe("MakerProfileData (persistence boundary)", () => {
  it("accepts a well-formed profile", () => {
    const ok = MakerProfileData.safeParse({
      machineName: "CO2 40W (generic)",
      materialName: "Birch ply 3mm",
      shop: DEFAULT_SHOP,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a malformed shop (non-positive markup)", () => {
    const bad = MakerProfileData.safeParse({
      machineName: "x",
      materialName: "y",
      shop: { ...DEFAULT_SHOP, markup: -1 },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a missing field", () => {
    const bad = MakerProfileData.safeParse({
      machineName: "x",
      shop: DEFAULT_SHOP,
    });
    expect(bad.success).toBe(false);
  });
});
