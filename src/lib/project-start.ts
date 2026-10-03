import type { Card } from "@/domain/card";
import { buildCards } from "@/domain/cards";
import { buildPlanningContext } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import type { PersistedProject } from "@/domain/persisted-project";
import { type ProjectPlan, slotCardId, slotRecipeId } from "@/domain/plan";
import type { Product } from "@/domain/product";
import { productUnderstanding } from "@/domain/product-understanding";
import type { ProjectType } from "@/domain/project";
import { SEED_BRAND } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import { projectTypeLabel } from "@/lib/project-types";
import { findRecipe } from "@/lib/recipes";
import { fallbackVariants } from "@/providers/mock/art-director";

// What a planned project starts with in the editor: the understanding written
// from the spec (no vision call), the product's reference as the anchor, and one
// draft card per scene slot. Drafts cost nothing; a generation runs only when
// the maker presses Generate on a card.

// A photo-source product already has its reference image. It must be a raster
// at an absolute http(s) URL: the providers fetch it server-side and reject SVG.
export function photoReference(product: Product): MasterAsset | null {
  if (product.source.kind !== "photo") return null;
  const url = product.source.assetUrl;
  if (!/^https?:\/\//.test(url)) return null;
  const mime = /\.jpe?g(\?|$)/i.test(url)
    ? "image/jpeg"
    : /\.webp(\?|$)/i.test(url)
      ? "image/webp"
      : /\.png(\?|$)/i.test(url)
        ? "image/png"
        : null;
  if (!mime) return null;
  return {
    id: `product-${product.id}`,
    origin: "product",
    sourcePrompt: null,
    assetUrl: url,
    mime,
  };
}

// One draft card per scene slot, per destination. Ids are `${destination}.${slot}`
// (unique across destinations; a video child appends "-video"); the recipe is
// the slot's shot list composed on its destination. Scenes come from the same
// deterministic fallback the studio uses without an ArtDirector; line-art shot
// lists skip it, as in the studio.
export function slotCards(
  plan: ProjectPlan,
  master: MasterAsset,
  understanding: BaseUnderstanding,
): Card[] {
  return plan.destinations.flatMap((d) => {
    const recipe = findRecipe(slotRecipeId(d.shotListId, d.destinationId));
    if (!recipe) {
      throw new Error(`no recipe for ${d.shotListId} on ${d.destinationId}`);
    }
    const scenes = d.slots.filter((s) => s.fill === "scene");
    if (scenes.length !== recipe.directions.length) {
      throw new Error(
        `the plan for ${d.destinationId} no longer matches its shot list`,
      );
    }
    const planning = buildPlanningContext(understanding, recipe, SEED_BRAND);
    const variants =
      recipe.style === "line-art"
        ? undefined
        : fallbackVariants(recipe, understanding, recipe.directions.length);
    return buildCards({ master, recipe, planning, variants }).map(
      (card, i) => ({
        ...card,
        id: slotCardId(d.destinationId, scenes[i].key),
        status: "draft" as const,
      }),
    );
  });
}

export function projectName(product: Product, type: ProjectType): string {
  return `${product.name} — ${projectTypeLabel(type)}`.slice(0, 80);
}

export function startEditorState(input: {
  product: Product;
  type: ProjectType;
  plan: ProjectPlan;
  master: MasterAsset | null;
}): PersistedProject {
  const { product, plan, master } = input;
  const understanding = productUnderstanding(product);
  const first = plan.destinations[0];
  return {
    name: projectName(product, input.type),
    phase: "generation",
    master,
    understanding,
    recipeId: slotRecipeId(first.shotListId, first.destinationId),
    planning: null,
    cards: master ? slotCards(plan, master, understanding) : [],
  };
}
