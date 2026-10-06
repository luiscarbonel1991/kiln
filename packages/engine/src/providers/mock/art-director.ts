import type { Recipe } from "@/domain/recipe";
import { sceneVariants } from "@/domain/scene-direction";
import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import type { ArtDirector } from "@/providers/interfaces";

// The recipe's own per-slot art direction (domain sceneVariants), with the
// analysis's place of use for `{use}`: what mock runs return, and what a maker
// can choose when no model could direct the scenes. Slots past the recipe's
// own get a numbered direction.
export function fallbackVariants(
  recipe: Recipe,
  understanding: BaseUnderstanding,
  n: number,
): VariantDirection[] {
  const slots = Array.from(
    { length: n },
    (_unused, i) =>
      recipe.directions[i] ?? {
        label: `Direction ${i + 1}`,
        purpose: `direction ${i + 1}`,
      },
  );
  return sceneVariants(
    slots,
    recipe.fieldDefaults,
    understanding,
    understanding.useContext ? [understanding.useContext] : [],
  );
}

export const mockArtDirector: ArtDirector = {
  async proposeDirections({ recipe, understanding, n }, options) {
    return {
      value: fallbackVariants(recipe, understanding, n),
      model: options.model,
    };
  },
};
