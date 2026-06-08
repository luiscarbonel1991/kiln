import { describe, expect, it } from "vitest";
import { SEED_BRAND, SEED_RECIPE } from "@/domain/seed";
import { googleArtDirector } from "@/providers/google/art-director";
import { mockVisionProvider } from "@/providers/mock/vision";

describe("art director (mock fallback without a key)", () => {
  it("returns one distinct direction spec per recipe direction", async () => {
    const understanding = await mockVisionProvider.analyze({
      assetUrl: "master.jpg",
    });
    const variants = await googleArtDirector.proposeDirections({
      understanding,
      recipe: SEED_RECIPE,
      brand: SEED_BRAND,
      n: 6,
    });

    expect(variants).toHaveLength(6);
    expect(variants.map((v) => v.direction)).toEqual(
      SEED_RECIPE.directions.map((d) => d.label),
    );
    for (const v of variants) {
      expect(v.scene).toBeTruthy();
      expect(v.composition).toBeTruthy();
      expect(v.lighting).toBeTruthy();
    }
  });
});
