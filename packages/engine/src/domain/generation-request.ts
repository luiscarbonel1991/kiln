import { z } from "zod";
import type { BrandProfile } from "@/domain/brand";
import type { Card } from "@/domain/card";
import { assemblePrompt } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import { ModelConfig } from "@/domain/model-config";
import { generationModel } from "@/domain/model-defaults";
import type { Recipe } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";

// Exactly what one paid image generation sends: built once (the editor shows
// it, the queue snapshots it on the job and every retry reuses it), so what the
// maker saw is what is paid for.
export const GenerationRequest = z.object({
  kind: z.literal("image"),
  masterAssetUrl: z.string().min(1),
  prompt: z.string().min(1),
  imageInputs: z.array(z.string()).default([]),
  negative: z.string().default(""),
  model: ModelConfig,
});
export type GenerationRequest = z.infer<typeof GenerationRequest>;

export function buildGenerationRequest(input: {
  card: Card;
  master: MasterAsset;
  understanding: BaseUnderstanding;
  recipe: Recipe;
  brand: BrandProfile;
}): GenerationRequest {
  const { card, master, understanding, recipe, brand } = input;
  const assembled = assemblePrompt(
    card,
    master,
    understanding,
    recipe,
    brand,
    card.direction,
  );
  return {
    kind: "image",
    masterAssetUrl: master.assetUrl,
    prompt: card.promptOverride ?? assembled.prompt,
    imageInputs: card.references,
    negative: assembled.negative,
    model: generationModel(card.model, "image"),
  };
}
