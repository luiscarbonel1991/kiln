import { describe, expect, it } from "vitest";
import { Recipe } from "@/domain/recipe";
import {
  findRecipe,
  RECIPE_PRESETS,
  SEED_RECIPE_LINE_ART,
  SEED_RECIPES,
  SHOT_LIST_LINE_ART,
} from "@/lib/recipes";

describe("app recipes", () => {
  it("the line-art recipe parses, is line-art, and has five takes", () => {
    expect(() => Recipe.parse(SEED_RECIPE_LINE_ART)).not.toThrow();
    expect(SEED_RECIPE_LINE_ART.id).toBe("recipe-line-art");
    expect(SEED_RECIPE_LINE_ART.style).toBe("line-art");
    expect(SEED_RECIPE_LINE_ART.directions).toHaveLength(5);
  });

  it("the app recipe list = engine generics + the line-art recipe", () => {
    // Engine generics (all photographic) flow through...
    expect(SEED_RECIPES.some((r) => r.id === "recipe-etsy-hero")).toBe(true);
    expect(SEED_RECIPES.some((r) => r.id === "recipe-ads")).toBe(true);
    // ...plus the app's line-art recipe — the only line-art one in the list.
    expect(SEED_RECIPES.some((r) => r.id === "recipe-line-art")).toBe(true);
    expect(SEED_RECIPES.filter((r) => r.style === "line-art")).toHaveLength(1);
  });
});

describe("findRecipe", () => {
  it("resolves every saved recipe id, including the app line-art preset", () => {
    for (const r of SEED_RECIPES) expect(findRecipe(r.id)).toBe(r);
  });

  it("returns undefined for an unknown id (call sites keep their fallback)", () => {
    expect(findRecipe("recipe-nope")).toBeUndefined();
  });
});

describe("line-art shot list", () => {
  it("is a Design brief with no destination", () => {
    expect(SHOT_LIST_LINE_ART.destinationId).toBeNull();
    expect(SHOT_LIST_LINE_ART.projectTypes).toEqual(["design"]);
    expect(RECIPE_PRESETS.at(-1)?.id).toBe("recipe-line-art");
  });

  it("says nothing about how the art is produced", () => {
    expect(JSON.stringify(SHOT_LIST_LINE_ART)).not.toMatch(
      /laser|\bcut\b|engrav|\bsigns?\b/i,
    );
  });
});
