import { contrastInk, scaleReference } from "@/domain/exact";
import { colourOf, dimensionsLabel, type Product } from "@/domain/product";
import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";

// The art direction of each scene slot, from data (no ArtDirector call): the
// slot's own scene / composition / lighting when its shot list writes them,
// else the list's defaults leaning toward the slot's purpose. `{use}` in a
// scene takes the product's places of use in order — the first slot that asks
// gets the most typical place, the next one the second, and so on — so in-use
// and lifestyle shots land where buyers really use the product. Those scenes
// also carry the product's cues (sceneCues): in a real place a model draws
// the product too big, too small to read, or lost against its wall.

export interface SceneSlot {
  label: string;
  purpose: string;
  scene?: string;
  composition?: string;
  lighting?: string;
}

export interface SceneDefaults {
  scene?: string;
  composition?: string;
}

// Where a `{use}` scene goes when the product names no place of use.
export const GENERIC_USE = "the place a customer actually uses it";

const USE = "{use}";

// "Show it gift-ready." -> "show it gift-ready": a purpose read inside a
// sentence. Only the first letter is lowered, so names ("Etsy") keep their case.
export function inSentence(text: string): string {
  const trimmed = text.trim().replace(/[.\s]+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

// What a scene in a real place must keep true of this product: its size
// against the everyday objects there (the nearest everyday reference, as in
// the exact scale frame), a size in the frame that keeps its text and design
// readable, and a background its face stands out from.
export function sceneCues(product: Product): string[] {
  const dims = product.dimensions;
  const ref = scaleReference(dims);
  const ratio = Math.max(dims.w, dims.h) / Math.max(ref.width, ref.height);
  const compared =
    ratio < 0.85
      ? "smaller than"
      : ratio > 1.15
        ? "larger than"
        : "about the size of";
  const dark =
    contrastInk(colourOf(product, product.defaultColour).face) === "#ffffff";
  return [
    `the product true to its real size (${dimensionsLabel(dims)}, ${compared} ${ref.name}) against every object around it`,
    "large enough in the frame for its text and design to read clearly, at least a quarter of the frame's width",
    dark
      ? "its dark face set against a lighter background, so it stands out"
      : "its light face set against a darker background, so it stands out",
  ];
}

export function sceneVariants(
  slots: SceneSlot[],
  defaults: SceneDefaults,
  understanding: BaseUnderstanding,
  useContexts: string[],
  cues: string[] = [],
): VariantDirection[] {
  const places = useContexts.map((c) => c.trim()).filter(Boolean);
  let next = 0;
  const place = () =>
    places.length > 0 ? places[next++ % places.length] : GENERIC_USE;
  const baseScene = defaults.scene ?? "soft neutral sweep";
  return slots.map((slot) => {
    const inPlace = slot.scene?.includes(USE) ?? false;
    const scene = slot.scene
      ? inPlace
        ? slot.scene.replaceAll(USE, place())
        : slot.scene
      : `${baseScene} — ${inSentence(slot.purpose)}`;
    const composition =
      slot.composition ?? defaults.composition ?? understanding.composition;
    return {
      direction: slot.label,
      scene,
      composition:
        inPlace && cues.length > 0
          ? [composition, ...cues].join("; ")
          : composition,
      lighting: slot.lighting ?? understanding.lighting,
    };
  });
}
