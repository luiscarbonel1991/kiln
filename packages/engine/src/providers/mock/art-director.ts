import type { Recipe } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import type { ArtDirector } from "@/providers/interfaces";

// Deterministic fallback (no GOOGLE_API_KEY / tests): derives per-slot specs from
// the recipe defaults, leaning each placeholder scene toward the slot's purpose.
// Genuine diversity comes from the real Gemini ArtDirector.
export function fallbackVariants(
  recipe: Recipe,
  understanding: BaseUnderstanding,
  n: number,
): VariantDirection[] {
  const baseScene = recipe.fieldDefaults.scene ?? "soft neutral sweep";
  const composition =
    recipe.fieldDefaults.composition ?? understanding.composition;
  return Array.from({ length: n }, (_unused, i) => {
    const slot = recipe.directions[i];
    const label = slot?.label ?? `Direction ${i + 1}`;
    const scene = slot?.purpose
      ? `${baseScene} — ${slot.purpose.toLowerCase()}`
      : `${baseScene} (${label.toLowerCase()})`;
    return {
      direction: label,
      scene,
      composition,
      lighting: understanding.lighting,
    };
  });
}

export const mockArtDirector: ArtDirector = {
  async proposeDirections({ recipe, understanding, n }) {
    return fallbackVariants(recipe, understanding, n);
  },
};
