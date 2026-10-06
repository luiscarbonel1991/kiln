import { describe, expect, it } from "vitest";
import { BrandProfile } from "@/domain/brand";
import { Recipe } from "@/domain/recipe";
import {
  SEED_BRAND,
  SEED_RECIPE,
  SEED_RECIPE_ADS,
  SEED_RECIPES,
} from "@/domain/seed";

describe("seed data", () => {
  it("SEED_BRAND parses cleanly and palette[0] is the UI primary", () => {
    expect(() => BrandProfile.parse(SEED_BRAND)).not.toThrow();
    expect(SEED_BRAND.palette[0]).toBe("#c0461f");
    expect(SEED_BRAND.palette.length).toBeGreaterThanOrEqual(1);
  });

  it("SEED_RECIPE parses cleanly with five scene slots and two targets", () => {
    expect(() => Recipe.parse(SEED_RECIPE)).not.toThrow();
    expect(SEED_RECIPE.directions).toHaveLength(5);
    for (const slot of SEED_RECIPE.directions) {
      expect(slot.label).toBeTruthy();
      expect(slot.purpose).toBeTruthy();
    }
    expect(SEED_RECIPE.targets.map((target) => target.aspect)).toEqual([
      "1:1",
      "2:3",
    ]);
    expect(SEED_RECIPE.constraints.negative).toContain("watermark");
  });

  it("SEED_RECIPE_ADS parses with five paid-ad slots and is in SEED_RECIPES", () => {
    expect(() => Recipe.parse(SEED_RECIPE_ADS)).not.toThrow();
    expect(SEED_RECIPE_ADS.id).toBe("recipe-ads");
    expect(SEED_RECIPE_ADS.directions).toHaveLength(5);
    for (const slot of SEED_RECIPE_ADS.directions) {
      expect(slot.label).toBeTruthy();
      expect(slot.purpose).toBeTruthy();
    }
    // Paid ads must cover the vertical (Reels/Stories) format.
    expect(SEED_RECIPE_ADS.targets.map((t) => t.aspect)).toContain("9:16");
    expect(SEED_RECIPE_ADS.directions.some((s) => s.aspect === "9:16")).toBe(
      true,
    );
    // No text baked into the image (the seller adds copy in their ad tool).
    expect(SEED_RECIPE_ADS.constraints.negative).toContain("text overlay");
    expect(SEED_RECIPES.some((r) => r.id === "recipe-ads")).toBe(true);
  });

  it("style defaults to photographic; the OSS engine ships NO line-art recipe", () => {
    expect(SEED_RECIPE.style).toBe("photographic");
    expect(SEED_RECIPE_ADS.style).toBe("photographic");
    // Guardrail: the engine ships the line-art STYLE capability; the line-art
    // design recipe lives in the app — no engine recipe is line-art.
    expect(SEED_RECIPES.every((r) => r.style === "photographic")).toBe(true);
    expect(SEED_RECIPES.some((r) => r.id === "recipe-line-art")).toBe(false);
  });
});
