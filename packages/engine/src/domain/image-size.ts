import type { DestinationProfile } from "@/domain/destination";
import { type ImageSize, modelEntry } from "@/domain/model-defaults";

// The size each scene is asked for (DOGFOOD #86: every Etsy hero was a 1024 px
// image stretched twice over to 2000). A destination whose pixel target a 1K
// image would reach only stretched more than STRETCH times gets its scenes at
// 2K, where the model offers it: Etsy (2000 px) and Amazon (1600), not
// Instagram (1080). Delivery still sizes every frame to the target; from 2K
// it shrinks instead of stretching.

const STANDARD_PX = 1024;
const STRETCH = 1.25;

// GPT Image 2 at 2K: each slot aspect exactly, its long side at 2048 and both
// sides multiples of 16 (the API's rule, image generation guide, 2026-11-02).
// An aspect not listed stays at 1K, so nothing unpriced is asked for.
export const OPENAI_2K: Readonly<
  Record<string, { width: number; height: number }>
> = {
  "1:1": { width: 2048, height: 2048 },
  "4:5": { width: 1600, height: 2000 },
  "5:4": { width: 2000, height: 1600 },
  "2:3": { width: 1344, height: 2016 },
  "3:2": { width: 2016, height: 1344 },
  "3:4": { width: 1536, height: 2048 },
  "4:3": { width: 2048, height: 1536 },
  "9:16": { width: 1152, height: 2048 },
  "16:9": { width: 2048, height: 1152 },
};

// GPT Image 2 at 1K, where no standard size has the slot's aspect (a 4:5 came
// back 2:3 and was cropped, DOGFOOD #78): the aspect exactly, its short side
// at or near 1024, both sides multiples of 16. 1:1, 2:3 and 3:2 keep the
// standard sizes.
export const OPENAI_1K: Readonly<
  Record<string, { width: number; height: number }>
> = {
  "4:5": { width: 1024, height: 1280 },
  "5:4": { width: 1280, height: 1024 },
  "3:4": { width: 1056, height: 1408 },
  "4:3": { width: 1408, height: 1056 },
  "9:16": { width: 1008, height: 1792 },
  "16:9": { width: 1792, height: 1008 },
};

const PORTRAIT = ["4:5", "2:3", "9:16", "3:4"];
const LANDSCAPE = ["5:4", "3:2", "16:9", "4:3"];
const wxh = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

// The exact size an OpenAI image request is sent at: GPT Image 2's own size
// for the aspect (at 2K, or at 1K where no standard size fits), else the
// nearest of the three standard sizes, which the GPT image models all take.
export function openaiSize(
  model: { provider: string; model: string; size?: ImageSize },
  aspect: string | undefined,
): string {
  const ratio = aspect ?? "1:1";
  if (sizeOn(model, ratio) === "2k") return wxh(OPENAI_2K[ratio]);
  const exact = modelEntry(model)?.exactAspects ? OPENAI_1K[ratio] : undefined;
  if (exact) return wxh(exact);
  if (PORTRAIT.includes(ratio)) return "1024x1536";
  if (LANDSCAPE.includes(ratio)) return "1536x1024";
  return "1024x1024";
}

// The short side a destination wants for a frame at this aspect: its format's
// pixel target for that aspect, else the largest it names, else 2000.
export function destinationTargetPx(
  aspect: string | undefined,
  destination: Pick<DestinationProfile, "formats">,
): number {
  const ratio = aspect ?? "1:1";
  const targets = destination.formats.flatMap((f) =>
    f.minPx ? [f.minPx] : [],
  );
  return (
    destination.formats.find((f) => f.aspect === ratio)?.minPx ??
    (targets.length > 0 ? Math.max(...targets) : 2000)
  );
}

// The size a destination's scenes are asked for at this aspect; 1k without a
// destination (a studio card).
export function destinationImageSize(
  aspect: string | undefined,
  destination: Pick<DestinationProfile, "formats"> | undefined,
): ImageSize {
  if (!destination) return "1k";
  return destinationTargetPx(aspect, destination) > STANDARD_PX * STRETCH
    ? "2k"
    : "1k";
}

// The size a request really runs at on its model: 2k only where the model
// offers it (and, on GPT Image 2, where its aspect has a 2K size); else 1k.
// The adapters send it and the estimates price it, so a fallback model
// without 2K runs, and is priced, at 1K.
export function sizeOn(
  model: { provider: string; model: string; size?: ImageSize },
  aspect: string | undefined,
): ImageSize {
  if (model.size !== "2k") return "1k";
  if (!modelEntry(model)?.sizes?.includes("2k")) return "1k";
  if (model.provider === "openai" && !OPENAI_2K[aspect ?? "1:1"]) return "1k";
  return "2k";
}
