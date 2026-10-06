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
// `{surface}` (the close looks) takes how the product's treatment must show:
// raised elements from a low angle that reveals their side walls, an
// engraving flush with the face.

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

// Where `{surface}` goes when no product is known (a photo project).
export const GENERIC_SURFACE = "the surface's texture and edges in focus";

const USE = "{use}";
const SURFACE = "{surface}";

// What the product adds to its scenes' direction: the cues of a scene set in
// a place of use, and how a close look shows its surface.
export interface ProductSceneCues {
  inPlace(place: string): string[];
  surface: string;
}

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

// How a close look must show the product's surface for its treatment to
// read: a frontal plate cannot show relief, so the camera has to.
export function surfaceCue(product: Product): string {
  switch (product.treatment) {
    case "raised":
      return "seen at a low raking angle across the face so the raised elements' side walls and short shadows show";
    case "engraved":
      return "seen nearly straight on, the engraving flush with the face, its textured cut surface catching the light";
    case "inlaid":
      return "seen nearly straight on, the inlay flush with the face";
    case "printed":
      return "seen nearly straight on, the print flat on the face";
    case "cut":
      return "the cut edges sharp and in focus";
  }
}

export function productSceneCues(product: Product): ProductSceneCues {
  return { inPlace: () => sceneCues(product), surface: surfaceCue(product) };
}

export function sceneVariants(
  slots: SceneSlot[],
  defaults: SceneDefaults,
  understanding: BaseUnderstanding,
  useContexts: string[],
  cues?: ProductSceneCues,
): VariantDirection[] {
  const places = useContexts.map((c) => c.trim()).filter(Boolean);
  let next = 0;
  const place = () =>
    places.length > 0 ? places[next++ % places.length] : GENERIC_USE;
  const baseScene = defaults.scene ?? "soft neutral sweep";
  const surface = (text: string) =>
    text.replaceAll(SURFACE, cues?.surface ?? GENERIC_SURFACE);
  return slots.map((slot) => {
    const where = slot.scene?.includes(USE) ? place() : null;
    const scene = slot.scene
      ? where
        ? slot.scene.replaceAll(USE, where)
        : slot.scene
      : `${baseScene} — ${inSentence(slot.purpose)}`;
    const composition = surface(
      slot.composition ?? defaults.composition ?? understanding.composition,
    );
    return {
      direction: slot.label,
      scene: surface(scene),
      composition:
        where && cues
          ? [composition, ...cues.inPlace(where)].join("; ")
          : composition,
      lighting: slot.lighting ?? understanding.lighting,
    };
  });
}
