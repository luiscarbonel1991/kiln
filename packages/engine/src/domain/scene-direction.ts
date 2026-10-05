import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";

// The art direction of each scene slot, from data (no ArtDirector call): the
// slot's own scene / composition / lighting when its shot list writes them,
// else the list's defaults leaning toward the slot's purpose. `{use}` in a
// scene takes the product's places of use in order — the first slot that asks
// gets the most typical place, the next one the second, and so on — so in-use
// and lifestyle shots land where buyers really use the product.

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

export function sceneVariants(
  slots: SceneSlot[],
  defaults: SceneDefaults,
  understanding: BaseUnderstanding,
  useContexts: string[],
): VariantDirection[] {
  const places = useContexts.map((c) => c.trim()).filter(Boolean);
  let next = 0;
  const place = () =>
    places.length > 0 ? places[next++ % places.length] : GENERIC_USE;
  const baseScene = defaults.scene ?? "soft neutral sweep";
  return slots.map((slot) => {
    const scene = slot.scene
      ? slot.scene.includes(USE)
        ? slot.scene.replaceAll(USE, place())
        : slot.scene
      : `${baseScene} — ${inSentence(slot.purpose)}`;
    return {
      direction: slot.label,
      scene,
      composition:
        slot.composition ?? defaults.composition ?? understanding.composition,
      lighting: slot.lighting ?? understanding.lighting,
    };
  });
}
