import { Recipe } from "@/domain/recipe";
import { SEED_RECIPES as ENGINE_RECIPES } from "@/domain/seed";

// The proprietary laser / line-art recipe (the maker IP) lives in the APP, NOT in
// the open-source @kiln/engine: the engine ships the line-art STYLE capability (the
// recipe `style` + the assemblePrompt branch), this ships the laser-specific
// cut/engrave/centerline treatments. Black strokes on white, one motif in five
// laser-ready slots; skips the ArtDirector (the slot purpose drives each).
export const SEED_RECIPE_LASER = Recipe.parse({
  id: "recipe-laser-lineart",
  name: "Laser / line",
  style: "line-art",
  directions: [
    {
      label: "Cut outline",
      purpose:
        "A bold single continuous outline of the whole shape — the clean silhouette to cut.",
      aspect: "1:1",
    },
    {
      label: "Engrave detail",
      purpose:
        "Fine interior line work for engraving — decorative detail, no solid fills.",
      aspect: "1:1",
    },
    {
      label: "Framed badge",
      purpose:
        "The motif inside a circular badge frame — coaster or sign ready.",
      aspect: "1:1",
    },
    {
      label: "Geometric",
      purpose:
        "A geometric, straight-line interpretation of the motif — modern and minimal.",
      aspect: "1:1",
    },
    {
      label: "Minimal",
      purpose: "The simplest one- or two-stroke version of the idea.",
      aspect: "1:1",
    },
  ],
  fieldDefaults: {
    scene: "the motif centered with a clean margin",
    composition: "balanced, filling the frame",
    lighting: "flat (line art, no lighting)",
  },
  targets: [{ name: "Laser", aspect: "1:1" }],
  constraints: {
    preserve: ["overall silhouette"],
    negative: [
      "color",
      "gradient",
      "shading",
      "grey",
      "photographic",
      "texture",
      "background scene",
    ],
  },
});

// The app's full recipe list = the engine's generic recipes + the laser recipe.
// App code imports THIS (not the engine's SEED_RECIPES) so the laser recipe shows
// in Planning and resolves on restore.
export const SEED_RECIPES: Recipe[] = [...ENGINE_RECIPES, SEED_RECIPE_LASER];
