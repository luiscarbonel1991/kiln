import { composePreset, type Recipe, RecipePreset } from "@/domain/recipe";
import {
  SEED_RECIPES as ENGINE_RECIPES,
  SEED_DESTINATIONS,
  SEED_RECIPE_PRESETS,
  SEED_SHOT_LISTS,
} from "@/domain/seed";
import { ShotList } from "@/domain/shot-list";

// The proprietary laser / line-art shot list (the maker IP) lives in the APP, NOT
// in the open-source @kiln/engine: the engine ships the line-art STYLE capability
// (the `style` + the assemblePrompt branch), this ships the laser-specific
// cut/engrave/centerline treatments. Black strokes on white, one motif in five
// laser-ready slots; skips the ArtDirector (the slot purpose drives each). It is
// a Design brief: no destination.
export const SHOT_LIST_LASER = ShotList.parse({
  id: "laser-line",
  name: "Laser / line",
  destinationId: null,
  projectTypes: ["design"],
  style: "line-art",
  fieldDefaults: {
    scene: "the motif centered with a clean margin",
    composition: "balanced, filling the frame",
    lighting: "flat (line art, no lighting)",
  },
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
  slots: [
    {
      key: "cut-outline",
      label: "Cut outline",
      purpose:
        "A bold single continuous outline of the whole shape — the clean silhouette to cut.",
      aspect: "1:1",
    },
    {
      key: "engrave-detail",
      label: "Engrave detail",
      purpose:
        "Fine interior line work for engraving — decorative detail, no solid fills.",
      aspect: "1:1",
    },
    {
      key: "framed-badge",
      label: "Framed badge",
      purpose:
        "The motif inside a circular badge frame — coaster or sign ready.",
      aspect: "1:1",
    },
    {
      key: "geometric",
      label: "Geometric",
      purpose:
        "A geometric, straight-line interpretation of the motif — modern and minimal.",
      aspect: "1:1",
    },
    {
      key: "minimal",
      label: "Minimal",
      purpose: "The simplest one- or two-stroke version of the idea.",
      aspect: "1:1",
    },
  ],
});

export const PRESET_LASER = RecipePreset.parse({
  id: "recipe-laser-lineart",
  name: "Laser / line",
  shotListId: SHOT_LIST_LASER.id,
  destinationId: null,
  targets: [{ name: "Laser", aspect: "1:1" }],
});

// The app's catalog = the engine's generic seeds + the laser shot list.
export const SHOT_LISTS: ShotList[] = [...SEED_SHOT_LISTS, SHOT_LIST_LASER];
export const DESTINATIONS = SEED_DESTINATIONS;
export const RECIPE_PRESETS: RecipePreset[] = [
  ...SEED_RECIPE_PRESETS,
  PRESET_LASER,
];

export const SEED_RECIPE_LASER = composePreset(PRESET_LASER, {
  shotLists: SHOT_LISTS,
  destinations: DESTINATIONS,
});

// The app's full recipe list = the engine's generic recipes + the laser recipe.
// App code imports THIS (not the engine's SEED_RECIPES) so the laser recipe shows
// in Planning and resolves on restore.
export const SEED_RECIPES: Recipe[] = [...ENGINE_RECIPES, SEED_RECIPE_LASER];

// The one lookup for a saved recipe id. Unknown ids return undefined; each call
// site keeps its own fallback.
export function findRecipe(id: string): Recipe | undefined {
  return SEED_RECIPES.find((r) => r.id === id);
}
