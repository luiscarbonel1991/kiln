import { type Catalog, parseSlotRecipeId } from "@/domain/plan";
import {
  composePreset,
  composeRecipe,
  type Recipe,
  RecipePreset,
} from "@/domain/recipe";
import {
  SEED_RECIPES as ENGINE_RECIPES,
  SEED_DESTINATIONS,
  SEED_RECIPE_PRESETS,
  SEED_SHOT_LISTS,
} from "@/domain/seed";
import { ShotList } from "@/domain/shot-list";

// The line-art design shot list: one motif redrawn as black strokes on white
// in five takes, the art a Design project traces into an SVG (vectorize). The
// engine ships the line-art STYLE (the `style` + the assemblePrompt branch);
// this list lives in the app with the Design flow. Generic for any maker: the
// takes say nothing about how the art is produced. Skips the ArtDirector (the
// slot purpose drives each). A Design brief: no destination.
export const SHOT_LIST_LINE_ART = ShotList.parse({
  id: "line-art",
  name: "Line art",
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
      key: "outline",
      label: "Outline",
      purpose:
        "A bold single continuous outline of the whole shape — a clean silhouette.",
      aspect: "1:1",
    },
    {
      key: "detail",
      label: "Interior detail",
      purpose: "Fine interior line work — decorative detail, no solid fills.",
      aspect: "1:1",
    },
    {
      key: "badge",
      label: "Badge",
      purpose: "The motif inside a circular badge frame.",
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

export const PRESET_LINE_ART = RecipePreset.parse({
  id: "recipe-line-art",
  name: "Line art",
  shotListId: SHOT_LIST_LINE_ART.id,
  destinationId: null,
  targets: [{ name: "Line art", aspect: "1:1" }],
});

// The app's catalog = the engine's generic seeds + the line-art shot list.
export const SHOT_LISTS: ShotList[] = [...SEED_SHOT_LISTS, SHOT_LIST_LINE_ART];
export const DESTINATIONS = SEED_DESTINATIONS;
export const RECIPE_PRESETS: RecipePreset[] = [
  ...SEED_RECIPE_PRESETS,
  PRESET_LINE_ART,
];

export const SEED_RECIPE_LINE_ART = composePreset(PRESET_LINE_ART, {
  shotLists: SHOT_LISTS,
  destinations: DESTINATIONS,
});

// The app's full recipe list = the engine's generic recipes + the line-art
// recipe. App code imports THIS (not the engine's SEED_RECIPES) so the line-art
// recipe shows in Planning and resolves on restore.
export const SEED_RECIPES: Recipe[] = [...ENGINE_RECIPES, SEED_RECIPE_LINE_ART];

export const CATALOG: Catalog = {
  destinations: DESTINATIONS,
  shotLists: SHOT_LISTS,
};

const composed = new Map<string, Recipe>();

// A planned project's card carries `shotListId@destinationId`: its recipe is
// that shot list composed on that destination (scene slots only).
function composedRecipe(id: string): Recipe | undefined {
  const ref = parseSlotRecipeId(id);
  if (!ref) return undefined;
  const cached = composed.get(id);
  if (cached) return cached;
  const shotList = SHOT_LISTS.find((l) => l.id === ref.shotListId);
  const destination = DESTINATIONS.find((d) => d.id === ref.destinationId);
  if (!shotList || !destination || shotList.destinationId !== destination.id) {
    return undefined;
  }
  const recipe = composeRecipe({
    id,
    name: shotList.name,
    shotList,
    destination,
  });
  composed.set(id, recipe);
  return recipe;
}

// The one lookup for a saved recipe id: an editor preset or a planned slot's
// composed recipe. Unknown ids return undefined; each call site keeps its own
// fallback.
export function findRecipe(id: string): Recipe | undefined {
  return SEED_RECIPES.find((r) => r.id === id) ?? composedRecipe(id);
}
