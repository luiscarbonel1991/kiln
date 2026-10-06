import { describe, expect, it } from "vitest";
import { SEED_RECIPE_LINE_ART, SEED_RECIPES } from "@/lib/recipes";
import legacy from "./fixtures/legacy-line-art-recipe.json";

// Golden parity for the app's line-art recipe (see the engine's
// legacy-recipes.test.ts for the generic seeds). Regenerated on purpose when
// the recipe became generic (ids and takes without "laser", 2026-10-05).
describe("line-art recipe (golden)", () => {
  it("equals the frozen recipe", () => {
    expect(SEED_RECIPE_LINE_ART).toEqual(legacy);
  });

  it("is the last entry of the app recipe list", () => {
    expect(SEED_RECIPES.at(-1)?.id).toBe("recipe-line-art");
  });
});
