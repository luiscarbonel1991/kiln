import { Type } from "@google/genai";
import { z } from "zod";
import type { BrandProfile } from "@/domain/brand";
import type { ListingSlot } from "@/domain/recipe";
import type { BaseUnderstanding } from "@/domain/understanding";
import { VariantDirection } from "@/domain/variant-direction";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import type { ArtDirector } from "@/providers/interfaces";
import { fallbackVariants } from "@/providers/mock/art-director";
import { MODELS } from "@/providers/models";

function prompt(
  understanding: BaseUnderstanding,
  brand: BrandProfile,
  slots: ListingSlot[],
): string {
  const slotLines = slots
    .map((s, i) => `${i + 1}. ${s.label} — goal: ${s.purpose}`)
    .join("\n");
  return `You are an e-commerce product photographer and conversion designer planning a buyer-ready Etsy/marketplace LISTING SET from a single product photo. Each shot is a LISTING SLOT with a specific commercial job — design it to do that job, not just to look nice.

PRODUCT (keep it identical in every shot — same shape, label, finish, color):
- Subject: ${understanding.subject}
- Product type: ${understanding.productType || understanding.subject}
- Where it is actually used: ${understanding.useContext || "infer from the product type"}
- Materials: ${understanding.materials}
- Mood: ${understanding.mood}

BRAND "${brand.name}" — tone: ${brand.tone.join(", ")}; visual style: ${brand.visualStyle.join(", ")}.
HARD CONSTRAINTS — never violate: ${brand.dontList.join("; ")}. No text, labels, callouts, arrows, rulers-with-numbers, or graphic overlays in ANY shot (these are real photographs).

First, REASON from "Where it is actually used" above: that is the truth for the contextual slots. What real surfaces, walls, doors, rooms, hands, or companion objects belong with THIS product? What everyday object conveys its true size? A product that hangs (a wall print, a mirror, an ornament) belongs on its wall or hook — NOT on a desk or table. Do not default to a desk, a tabletop, or a studio sweep for the contextual slots.

Plan ${slots.length} DISTINCT photorealistic shots, ONE PER SLOT below, each serving its goal:
${slotLines}

For EACH slot return:
- scene: WHERE the product sits and the concrete environment + props that serve this slot's goal (be specific and real).
- composition: camera framing/angle/crop that sells this slot.
- lighting: the light setup.

Slot rules:
- "Marketplace hero": clean seamless near-white or soft neutral studio background, soft natural contact shadow, NO props, product centered and filling ~80% of frame — optimized to win the click as a thumbnail.
- "In-use mockup": place the product EXACTLY at its "Where it is actually used" location (a mug held in-hand on a kitchen counter; a print hung on a living-room wall; a candle lit on a bedside table; a planter on a sunny windowsill). Show its function in real context. The product stays the unmistakable hero, sharp and well-lit.
- "Scale & size": the scene MUST include a clear size reference — the product held in a human hand, OR placed directly beside a common everyday object of known size (a coffee mug, a paperback book, a coin). This size cue is MANDATORY; a plain or flat-lay shot with NO size reference does NOT satisfy this slot. No rulers or measurement text.
- "Lifestyle scene": style the product into an aspirational, lived-in real-world setting that matches how it is used — a hung product on a styled wall, a tabletop product on a set table or shelf, a worn product on a person — selling the feeling and brand world, broader and more atmospheric than the functional in-use shot. Match the setting to "Where it is actually used", never a generic desk.
- "Material detail": extreme macro on texture, finish, glaze, grain, seams, or edges that prove craftsmanship and justify the price.
- "Packaging / gift": show the product gift-ready — with its packaging, wrap, ribbon, or a branded insert/card — to invite gift purchases.
- "Alternate angle": the same product from a different angle (back, side, three-quarter) on the same clean background so nothing is hidden.
- Any other slot: fulfill its stated goal literally.

Make the shots genuinely different from one another — different places, framings, and light — not one scene reworded. Every scene must be a believable PHOTOGRAPH, with the same physical product.`;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    variants: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING },
          scene: { type: Type.STRING },
          composition: { type: Type.STRING },
          lighting: { type: Type.STRING },
        },
        required: ["direction", "scene", "composition", "lighting"],
      },
    },
  },
  required: ["variants"],
} as const;

// Real Gemini text ArtDirector: proposes a diverse scene/composition/lighting per
// listing slot, serving each slot's commercial purpose (the product placed in
// context, not copies). Falls back to the deterministic mock without a key (and on
// any error).
export const googleArtDirector: ArtDirector = {
  async proposeDirections({ understanding, recipe, brand, n }) {
    if (!hasGoogleKey()) return fallbackVariants(recipe, understanding, n);
    const slots = recipe.directions.slice(0, n);
    const fallback = fallbackVariants(recipe, understanding, n);
    try {
      const res = await getGenAI().models.generateContent({
        model: MODELS.google.vision,
        contents: [{ text: prompt(understanding, brand, slots) }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      });
      const parsed = JSON.parse(res.text ?? "{}");
      const variants = z.array(VariantDirection).parse(parsed.variants ?? []);
      // Pin each to its slot label, in order; fall back if the model returns short.
      return slots.map((slot, i) =>
        variants[i] ? { ...variants[i], direction: slot.label } : fallback[i],
      );
    } catch {
      return fallback;
    }
  },
};
