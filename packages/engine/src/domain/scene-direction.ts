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

// Everyday objects a place of use often names, with a typical size (inches,
// width x height), so a scene can size the product against what is really
// beside it. Matched in the place's words, the longest name first ("video
// doorbell" before "door").
const PLACE_OBJECTS: {
  names: string[];
  label: string;
  w: number;
  h: number;
}[] = [
  { names: ["front door", "door"], label: "door", w: 36, h: 80 },
  { names: ["video doorbell"], label: "video doorbell", w: 2.4, h: 5 },
  { names: ["doorbell"], label: "doorbell", w: 1.5, h: 3 },
  { names: ["doorknob", "door knob"], label: "doorknob", w: 2.5, h: 2.5 },
  { names: ["light switch"], label: "light switch", w: 2.75, h: 4.5 },
  { names: ["window"], label: "window", w: 36, h: 48 },
  { names: ["mug", "cup"], label: "mug", w: 3.5, h: 4 },
  { names: ["wine glass"], label: "wine glass", w: 3.5, h: 8 },
  { names: ["book", "books"], label: "book", w: 6, h: 9 },
  { names: ["laptop"], label: "laptop", w: 12, h: 8.5 },
  { names: ["phone", "smartphone"], label: "phone", w: 2.8, h: 5.8 },
  { names: ["picture frame"], label: "picture frame", w: 8, h: 10 },
  { names: ["candle"], label: "candle", w: 3, h: 4 },
  { names: ["vase"], label: "vase", w: 6, h: 10 },
  { names: ["armchair"], label: "armchair", w: 32, h: 36 },
  { names: ["sofa", "couch"], label: "sofa", w: 84, h: 34 },
  { names: ["coffee table"], label: "coffee table", w: 40, h: 18 },
  { names: ["dining table"], label: "dining table", w: 72, h: 30 },
  { names: ["nightstand"], label: "nightstand", w: 20, h: 24 },
];

// The objects a place names, in the order they appear (at most two).
export function placeObjects(
  place: string,
): { label: string; w: number; h: number }[] {
  const text = place.toLowerCase();
  const names = PLACE_OBJECTS.flatMap((o) =>
    o.names.map((name) => ({ name, object: o })),
  ).sort((a, b) => b.name.length - a.name.length);
  const taken: [number, number][] = [];
  const found: { at: number; object: (typeof PLACE_OBJECTS)[number] }[] = [];
  for (const { name, object } of names) {
    const match = new RegExp(`\\b${name}\\b`).exec(text);
    if (!match) continue;
    const span: [number, number] = [match.index, match.index + name.length];
    if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue;
    if (found.some((f) => f.object === object)) continue;
    taken.push(span);
    found.push({ at: match.index, object });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, 2)
    .map(({ object: { label, w, h } }) => ({ label, w, h }));
}

// "about 1/7 as wide as the door", "about twice as wide as the video doorbell".
function widthAgainst(
  productWidthIn: number,
  object: { label: string; w: number },
) {
  const r = productWidthIn / object.w;
  if (r >= 0.85 && r <= 1.15) return `about as wide as the ${object.label}`;
  if (r < 0.85) {
    const n = Math.round(1 / r);
    if (n < 2) return `a little narrower than the ${object.label}`;
    if (n > 30) return `tiny beside the ${object.label}`;
    return `about 1/${n} as wide as the ${object.label}`;
  }
  const k = Math.round(r * 2) / 2;
  return k === 2
    ? `about twice as wide as the ${object.label}`
    : `about ${k} times as wide as the ${object.label}`;
}

// What a scene in a real place must keep true of this product: its size
// against the objects its place names (else the nearest everyday reference,
// as in the exact scale frame), never enlarged to fill the frame (the frame
// comes closer instead, so its text reads), and a background its face stands
// out from.
export function sceneCues(product: Product, place = ""): string[] {
  const dims = product.dimensions;
  const widthIn = dims.unit === "mm" ? dims.w / 25.4 : dims.w;
  const objects = placeObjects(place);
  let size: string;
  if (objects.length > 0) {
    size = `the product true to its real size: ${dimensionsLabel(dims)}, ${objects.map((o) => widthAgainst(widthIn, o)).join(" and ")}`;
  } else {
    const ref = scaleReference(dims);
    const ratio = Math.max(dims.w, dims.h) / Math.max(ref.width, ref.height);
    const compared =
      ratio < 0.85
        ? "smaller than"
        : ratio > 1.15
          ? "larger than"
          : "about the size of";
    size = `the product true to its real size (${dimensionsLabel(dims)}, ${compared} ${ref.name}) against every object around it`;
  }
  const dark =
    contrastInk(colourOf(product, product.defaultColour).face) === "#ffffff";
  return [
    size,
    "never enlarged beyond its real size: frame closer to it instead, so its text and design still read",
    dark
      ? "its dark face set against a lighter background, so it stands out"
      : "its light face set against a darker background, so it stands out",
    // The objects named for scale invite their brands and labels.
    "everything around it plain and unbranded",
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
  return {
    inPlace: (place) => sceneCues(product, place),
    surface: surfaceCue(product),
  };
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
