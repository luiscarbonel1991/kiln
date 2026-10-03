import { describe, expect, it } from "vitest";
import { SEED_RECIPE_LASER, SEED_RECIPES } from "@/lib/recipes";
import legacy from "./fixtures/legacy-laser-recipe.json";

// Golden parity for the app-only laser recipe (see the engine's
// legacy-recipes.test.ts for the generic seeds).
describe("legacy laser recipe (golden)", () => {
  it("equals the frozen pre-split recipe", () => {
    expect(SEED_RECIPE_LASER).toEqual(legacy);
  });

  it("is the last entry of the app recipe list", () => {
    expect(SEED_RECIPES.at(-1)?.id).toBe("recipe-laser-lineart");
  });
});
