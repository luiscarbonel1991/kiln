import { describe, expect, it } from "vitest";
import { Recipe } from "@/domain/recipe";
import { SEED_RECIPE_LASER, SEED_RECIPES } from "@/lib/recipes";

describe("app recipes", () => {
  it("the laser recipe parses, is line-art, and has five treatments", () => {
    expect(() => Recipe.parse(SEED_RECIPE_LASER)).not.toThrow();
    expect(SEED_RECIPE_LASER.id).toBe("recipe-laser-lineart");
    expect(SEED_RECIPE_LASER.style).toBe("line-art");
    expect(SEED_RECIPE_LASER.directions).toHaveLength(5);
  });

  it("the app recipe list = engine generics + the laser recipe", () => {
    // Engine generics (all photographic) flow through...
    expect(SEED_RECIPES.some((r) => r.id === "recipe-etsy-hero")).toBe(true);
    expect(SEED_RECIPES.some((r) => r.id === "recipe-ads")).toBe(true);
    // ...plus the app's laser recipe — the only line-art one in the list.
    expect(SEED_RECIPES.some((r) => r.id === "recipe-laser-lineart")).toBe(
      true,
    );
    expect(SEED_RECIPES.filter((r) => r.style === "line-art")).toHaveLength(1);
  });
});
