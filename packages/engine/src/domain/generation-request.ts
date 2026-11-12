import { z } from "zod";
import type { BrandProfile } from "@/domain/brand";
import type { Card } from "@/domain/card";
import { assemblePrompt } from "@/domain/cascade";
import { sizeOn } from "@/domain/image-size";
import type { MasterAsset } from "@/domain/master-asset";
import { ModelConfig } from "@/domain/model-config";
import {
  defaultVideoModel,
  modelLabel,
  ProviderId,
} from "@/domain/model-defaults";
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
  // A test take (DOGFOOD #53): the scene at its model's low quality, a cheap
  // check of the direction, never approved for a listing.
  test: z.boolean().optional(),
  // The text model that looks at the take once it lands, for anything a
  // shopper would see as impossible (domain SceneLook). Priced in the job's
  // estimate; absent when the maker turned the look off.
  look: z.object({ provider: ProviderId, model: z.string().min(1) }).optional(),
});
export type ImageGenerationRequest = z.infer<typeof ImageGenerationRequest>;

export const VideoGenerationRequest = z.object({
  kind: z.literal("video"),
  startFrameUrl: z.string().min(1),
  prompt: z.string().min(1),
  motion: z.string().min(1),
  durationSec: VideoSeconds,
  // What the clip must never show; the prompt says it too, and Gemini Omni,
  // which takes no negative prompt, reads it there.
  negative: z.string().default(""),
  model: ModelConfig,
});
export type VideoGenerationRequest = z.infer<typeof VideoGenerationRequest>;

export const GenerationRequest = z.discriminatedUnion("kind", [
  ImageGenerationRequest,
  VideoGenerationRequest,
]);
export type GenerationRequest = z.infer<typeof GenerationRequest>;

// A request's model as the maker reads it before spending: "GPT Image 2
// medium 2K", "Gemini Omni Flash 720p".
export function requestModelLabel(request: GenerationRequest): string {
  const detail =
    request.kind === "video"
      ? [request.model.resolution ?? null]
      : [
          request.model.quality ??
            (request.model.provider === "openai" ? "medium" : null),
          sizeOn(request.model, request.model.aspect) === "2k" ? "2K" : null,
        ];
  return [modelLabel(request.model), ...detail].filter(Boolean).join(" ");
}

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
    model: card.model,
  };
}

export class VideoNeedsScene extends Error {}

// A version of an approved scene at another aspect: the approved image is the
// reference, re-framed and never cropped, so the product, the place and the
// light stay what the maker approved; the scene is extended where the new frame
// needs room. A slot with a text layer keeps calm space for it (a story's below
// the app's top bar).
export function buildVersionRequest(input: {
  product: Product;
  // The approved scene this version re-frames.
  sourceOutput: string;
  aspect: string;
  text: boolean;
  model: ModelConfig;
}): ImageGenerationRequest {
  const u = productUnderstanding(input.product, { images: false });
  const subject = u.subject.replaceAll("the master image", "the photograph");
  const [w, h] = input.aspect.split(":").map(Number);
  const shape =
    w && h ? (w === h ? "square" : w < h ? "taller" : "wider") : "new";
  const prompt = [
    `Re-frame this photograph for a ${shape} ${input.aspect} frame: the same photograph, recomposed.`,
    `The product: ${subject}; ${u.materials}.`,
    "Keep the product exactly as it is in the photograph: its shape, proportions, every letter of its wording, its colours and finish, and keep it whole in the frame.",
    "Keep the same place, light, props and styling; extend the scene naturally where the new frame needs more room. Never crop into the product.",
    input.text
      ? w && h && h / w >= 1.7
        ? "Leave calm, clean space across the upper third, below the top edge, for a short headline."
        : "Leave calm, clean space across the top for a short headline."
      : "",
    `Add no text, captions, logos, people or new objects.${u.avoid ? ` Never: ${u.avoid}.` : ""}`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    kind: "image",
    masterAssetUrl: input.sourceOutput,
    prompt,
    imageInputs: [],
    negative: [
      u.avoid,
      "text, captions, logos, watermarks, people, cropped product",
    ]
      .filter(Boolean)
      .join(", "),
    model: { ...input.model, aspect: input.aspect },
  };
}

// A video of the product from its spec, starting from an approved scene: the
// product as the spec says it is (material, treatment with its relief, the
// colour of its marks), the scene the frame shows, and locks the model must
// keep — the product never moves or morphs, nothing is added. What the
// treatment must never look like goes in the prompt and in the negative.
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
  const u = productUnderstanding(product, { images: false });
  const subject = u.subject.replaceAll("the master image", "the start frame");
  const scene = input.scene?.trim().replace(/[.\s]+$/, "");
  const prompt = [
    "Product video: animate the start frame, a photograph of the product.",
    `The product: ${subject}; ${u.materials}.`,
    scene ? `The scene stays the start frame's: ${scene}.` : "",
    "Keep the product exactly as in the start frame: its shape, proportions, every letter of its wording, its colours and finish. It does not move, bend, flicker or morph; only the camera and the light move.",
    "Everything around the product keeps its place, shape and markings; nothing new appears.",
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
    negative: [
      u.avoid,
      "text, captions, logos, watermarks, people, hands, speech, music",
    ]
      .filter(Boolean)
      .join(", "),
    model: ModelConfig.parse({
      ...defaultVideoModel(),
      ...input.model,
      aspect: aspectOf(settings.orientation),
    }),
  };
}
