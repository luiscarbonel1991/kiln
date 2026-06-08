"use server";

import { z } from "zod";
import { SEED_BRAND } from "@/domain/seed";
import { BaseUnderstanding } from "@/domain/understanding";
import { VariantDirection } from "@/domain/variant-direction";
import { SEED_RECIPES } from "@/lib/recipes";
import { getArtDirector } from "@/providers/registry";

const ProposeInput = z.object({
  understanding: BaseUnderstanding,
  recipeId: z.string(),
});

// Server Function: the only client path into the ArtDirector. Given the analyzed
// product + the selected recipe, returns a diverse scene/composition/lighting — one
// variant per recipe slot (Gemini text; mock fallback without a key). The card count
// follows the same slot count (see buildCards). Zod is the trust boundary.
export async function proposeVariants(
  input: unknown,
): Promise<VariantDirection[]> {
  const { understanding, recipeId } = ProposeInput.parse(input);
  const recipe = SEED_RECIPES.find((r) => r.id === recipeId) ?? SEED_RECIPES[0];
  const variants = await getArtDirector().proposeDirections({
    understanding,
    recipe,
    brand: SEED_BRAND,
    n: recipe.directions.length,
  });
  return z.array(VariantDirection).parse(variants);
}
