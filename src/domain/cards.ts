import { Card } from "@/domain/card";
import type { PlanningFields } from "@/domain/cascade";
import type { Field } from "@/domain/field";
import { lockByDefault } from "@/domain/locks";
import type { MasterAsset } from "@/domain/master-asset";
import { DEFAULT_MODEL_IDS } from "@/domain/model-defaults";
import type { Recipe } from "@/domain/recipe";
import type { VariantDirection } from "@/domain/variant-direction";

// A card field re-derives its lock from its source at creation time:
// image/brand -> locked, recipe/local -> unlocked (the default lock rule).
function cardField(field: Field): Field {
  return {
    value: field.value,
    source: field.source,
    locked: lockByDefault(field.source),
  };
}

// Builds one card per recipe listing slot. The shared planning gives subject +
// palette (consistent product and colors); the ArtDirector's per-direction
// `variants` diversify scene, composition, and lighting so the cards are genuinely
// different, not copies. Without variants, all cards share the planning fields
// (deterministic fallback). Master is the anchor (masterAssetId).
export function buildCards({
  master,
  recipe,
  planning,
  variants,
  n,
}: {
  master: MasterAsset;
  recipe: Recipe;
  planning: PlanningFields;
  variants?: VariantDirection[];
  n?: number;
}): Card[] {
  // Card count follows the recipe's slot count (Etsy 6, Paid ads 5, Social 4); `n`
  // is a test-only override. Must match the slots so there are no orphan cards.
  const count = n ?? recipe.directions.length;
  return Array.from({ length: count }, (_unused, i) => {
    const variant = variants?.[i];
    const recipeField = (value: string): Field =>
      cardField({ value, source: "recipe", locked: false });
    return Card.parse({
      id: `${recipe.id}-${i}`,
      parentId: null,
      masterAssetId: master.id,
      recipeId: recipe.id,
      type: "image",
      direction:
        variant?.direction ??
        recipe.directions[i]?.label ??
        `Direction ${i + 1}`,
      fields: {
        subject: cardField(planning.subject),
        materials: cardField(planning.materials),
        scene: variant ? recipeField(variant.scene) : cardField(planning.scene),
        composition: variant
          ? recipeField(variant.composition)
          : cardField(planning.composition),
        lighting: variant
          ? recipeField(variant.lighting)
          : cardField(planning.lighting),
        mood: cardField(planning.mood),
        palette: cardField(planning.palette),
      },
      references: [],
      model: {
        provider: "google",
        model: DEFAULT_MODEL_IDS.google.image,
        aspect: recipe.directions[i]?.aspect ?? "4:5",
        guidance: 7.5,
        strength: 0.65,
      },
    });
  });
}
