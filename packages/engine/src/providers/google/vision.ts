import { Type } from "@google/genai";
import { SEED_BRAND } from "@/domain/seed";
import { BaseUnderstanding } from "@/domain/understanding";
import { fetchAsset } from "@/providers/asset-bytes";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import type { VisionProvider } from "@/providers/interfaces";

// The Gemini model vision and the art director run on.
export const GEMINI_TEXT_MODEL = "gemini-3.5-flash";

// Mock fallback when GOOGLE_API_KEY is absent (the original Phase 3 mock values).
function mockUnderstanding(): BaseUnderstanding {
  return BaseUnderstanding.parse({
    subject: "glazed stoneware pitcher, matte cream finish",
    productType: "ceramic pitcher",
    useContext: "sits on a kitchen counter, dining table or open shelf",
    sceneProps: "",
    materials: "stoneware, reactive glaze",
    lighting: "soft directional light, upper-left",
    composition: "centered, slight high angle",
    mood: "calm, handmade, editorial",
    palette: SEED_BRAND.palette,
  });
}

// Neutral fallback when the Google call itself fails (e.g. monthly spend cap):
// nothing product-specific is invented; the card fields are edited by hand.
function degradedUnderstanding(): BaseUnderstanding {
  return BaseUnderstanding.parse({
    subject: "the exact product shown in the master image",
    productType: "product",
    useContext: "",
    sceneProps: "",
    materials: "as shown in the master image",
    lighting: "soft directional light, upper-left",
    composition: "centered, eye-level",
    mood: "clean, modern",
    palette: SEED_BRAND.palette,
  });
}

// Real Gemini multimodal: reads the master image bytes and returns a structured
// BaseUnderstanding (JSON-mode via responseSchema). Falls back to the mock w/o key.
export const googleVisionProvider: VisionProvider = {
  async analyze(input) {
    if (!hasGoogleKey()) return mockUnderstanding();
    try {
      const img = await fetchAsset(input.assetUrl);
      const res = await getGenAI().models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: [
          {
            text: [
              "Analyze this single product image for a brand content studio that will place the EXACT product into new scenes. Return JSON:",
              "- subject: the product in a short phrase.",
              "- productType: a concrete product-category noun, e.g. 'coffee mug', 'scented candle', 'wall print', 'ceramic planter'.",
              "- useContext: where this product actually lives / is used / installed / displayed in real life — one short phrase, e.g. 'held at a kitchen counter', 'on a bedside table', 'hung on a living-room wall', 'on a sunny windowsill'. Infer from the product type, not just this photo.",
              "- sceneProps: name, as a short NOUN phrase, anything visible in THIS photo that is a prop, mount, hand, stand or surface and is NOT part of the product itself, e.g. 'a wooden display stand', 'a hand', 'a hook'. Use an empty string if the product is shown alone on a plain background.",
              "- materials, lighting, composition, mood: each a short phrase.",
              "- palette: 3-6 dominant colors as hex strings like #aabbcc.",
            ].join("\n"),
          },
          { inlineData: { mimeType: img.mime, data: img.base64 } },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              productType: { type: Type.STRING },
              useContext: { type: Type.STRING },
              sceneProps: { type: Type.STRING },
              materials: { type: Type.STRING },
              lighting: { type: Type.STRING },
              composition: { type: Type.STRING },
              mood: { type: Type.STRING },
              palette: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "subject",
              "productType",
              "useContext",
              "sceneProps",
              "materials",
              "lighting",
              "composition",
              "mood",
              "palette",
            ],
          },
        },
      });
      return BaseUnderstanding.parse(JSON.parse(res.text ?? "{}"));
    } catch (err) {
      // Google errored at call time (spend cap, quota, network): degrade like the
      // ArtDirector does instead of blocking the flow. The user overrides fields anyway.
      console.error(
        "[kiln] vision analyze failed, using degraded understanding:",
        err instanceof Error ? err.message : err,
      );
      return degradedUnderstanding();
    }
  },
};
