import { z } from "zod";
import type { BrandProfile } from "@/domain/brand";
import type { Card } from "@/domain/card";
import { assemblePrompt } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import { ModelConfig } from "@/domain/model-config";
import { defaultVideoModel, generationModel } from "@/domain/model-defaults";
import type { VideoSettings } from "@/domain/plan";
import type { Product } from "@/domain/product";
import { productUnderstanding } from "@/domain/product-understanding";
import type { Recipe } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";
import { aspectOf, VIDEO_MOTIONS, VideoSeconds } from "@/domain/video";

// Exactly what one paid generation sends: built once (the editor shows it, the
// queue snapshots it on the job and every retry reuses it), so what the maker
// saw is what is paid for. An image edits the product's reference; a video
// animates a scene the maker approved.
export const ImageGenerationRequest = z.object({
  kind: z.literal("image"),
  masterAssetUrl: z.string().min(1),
  prompt: z.string().min(1),
  imageInputs: z.array(z.string()).default([]),
  negative: z.string().default(""),
  model: ModelConfig,
});
export type ImageGenerationRequest = z.infer<typeof ImageGenerationRequest>;

export const VideoGenerationRequest = z.object({
  kind: z.literal("video"),
  startFrameUrl: z.string().min(1),
  prompt: z.string().min(1),
  motion: z.string().min(1),
  durationSec: VideoSeconds,
  model: ModelConfig,
});
export type VideoGenerationRequest = z.infer<typeof VideoGenerationRequest>;

export const GenerationRequest = z.discriminatedUnion("kind", [
  ImageGenerationRequest,
  VideoGenerationRequest,
]);
export type GenerationRequest = z.infer<typeof GenerationRequest>;

export function buildGenerationRequest(input: {
  card: Card;
  master: MasterAsset;
  understanding: BaseUnderstanding;
  recipe: Recipe;
  brand: BrandProfile;
}): ImageGenerationRequest {
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

export class VideoNeedsScene extends Error {}

// A video of the product from its spec, starting from an approved scene: the
// product as the spec says it is (material, treatment with its relief, the
// colour of its marks), the scene the frame shows, and locks the model must
// keep — the product never moves or morphs, nothing is added. What the
// treatment must never look like goes in the prompt (Sora takes no negative).
export function buildVideoRequest(input: {
  product: Product;
  settings: VideoSettings;
  // The approved scene's own scene direction, when known.
  scene?: string;
  model?: Partial<ModelConfig>;
}): VideoGenerationRequest {
  const { product, settings } = input;
  if (!settings.startFrame) {
    throw new VideoNeedsScene(
      "Approve a scene first: the video starts from an approved scene, never a new image.",
    );
  }
  const u = productUnderstanding(product);
  const subject = u.subject.replaceAll("the master image", "the start frame");
  const scene = input.scene?.trim().replace(/[.\s]+$/, "");
  const prompt = [
    "Product video: animate the start frame, a photograph of the product.",
    `The product: ${subject}; ${u.materials}.`,
    scene ? `The scene stays the start frame's: ${scene}.` : "",
    "Keep the product exactly as in the start frame: its shape, proportions, every letter of its wording, its colours and finish. It does not move, bend, flicker or morph; only the camera and the light move.",
    `Add no text, captions, logos, people or new objects.${u.avoid ? ` Never: ${u.avoid}.` : ""}`,
    "Photorealistic, steady, natural motion",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    kind: "video",
    startFrameUrl: settings.startFrame,
    prompt,
    motion: VIDEO_MOTIONS[settings.motion].text,
    durationSec: settings.seconds,
    model: ModelConfig.parse({
      ...generationModel(
        { ...defaultVideoModel(), ...input.model, aspect: "9:16" },
        "video",
      ),
      aspect: aspectOf(settings.orientation),
    }),
  };
}
