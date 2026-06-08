import type { BrandProfile } from "@/domain/brand";
import type { Recipe } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import type {
  Capabilities,
  GenerationResult,
  ImageComposeInput,
  ImageEditInput,
  ImageGenInput,
} from "@/providers/types";

export type ProviderId = "google" | "openai";

// (a) Vision / analysis: MasterAsset -> BaseUnderstanding (structured, Zod-validated).
export interface VisionProvider {
  analyze(input: { assetUrl: string }): Promise<BaseUnderstanding>;
}

// (b) Art director: text model -> diverse per-direction creative specs (scene,
// composition, lighting), orthogonal not variations. buildCards combines these
// with the shared planning (subject + palette) into the cards.
export interface ArtDirector {
  proposeDirections(input: {
    understanding: BaseUnderstanding;
    recipe: Recipe;
    brand: BrandProfile;
    n: number;
  }): Promise<VariantDirection[]>;
}

// (c) Image executor.
export interface ImageProvider {
  readonly id: ProviderId;
  readonly capabilities: Capabilities;
  generate(input: ImageGenInput): Promise<GenerationResult>;
  edit(input: ImageEditInput): Promise<GenerationResult>;
  compose(input: ImageComposeInput): Promise<GenerationResult>;
}

// (d) Video executor (image-to-video).
export interface VideoProvider {
  readonly id: ProviderId;
  animate(input: {
    startFrameAssetId: string;
    prompt: string;
    motion: string;
    durationSec: number;
  }): Promise<GenerationResult>;
}
