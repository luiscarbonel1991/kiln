"use server";

import { z } from "zod";
import { defaultTextModel, ProviderId } from "@/domain/model-defaults";
import { SEED_BRAND } from "@/domain/seed";
import { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import { findRecipe, SEED_RECIPES } from "@/lib/recipes";
import { type Degraded, directScenes } from "@/server/text-calls";

const ProposeInput = z.object({
  understanding: BaseUnderstanding,
  recipeId: z.string(),
  model: z
    .object({ provider: ProviderId, model: z.string().min(1) })
    .optional(),
});

// Server Function: the only client path into the ArtDirector. Given the analyzed
// product + the selected recipe, returns a diverse scene/composition/lighting — one
// variant per recipe slot — on the maker's text model unless another is named.
// A failure comes back as the recipe's own directions with why, so the maker
// chooses between them and the other provider. Zod is the trust boundary.
export async function proposeVariants(
  input: unknown,
): Promise<{ variants: VariantDirection[]; degraded?: Degraded }> {
  const { understanding, recipeId, model } = ProposeInput.parse(input);
  const recipe = findRecipe(recipeId) ?? SEED_RECIPES[0];
  return directScenes(
    {
      understanding,
      recipe,
      brand: SEED_BRAND,
      n: recipe.directions.length,
    },
    model ?? defaultTextModel(),
  );
}
