import { Type } from "@google/genai";
import { SEED_BRAND } from "@/domain/seed";
import { BaseUnderstanding } from "@/domain/understanding";
import { fetchAsset } from "@/providers/asset-bytes";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import type { VisionProvider } from "@/providers/interfaces";
import { MODELS } from "@/providers/models";

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

// Real Gemini multimodal: reads the master image bytes and returns a structured
// BaseUnderstanding (JSON-mode via responseSchema). Falls back to the mock w/o key.
export const googleVisionProvider: VisionProvider = {
  async analyze(input) {
    if (!hasGoogleKey()) return mockUnderstanding();
    const img = await fetchAsset(input.assetUrl);
    const res = await getGenAI().models.generateContent({
      model: MODELS.google.vision,
      contents: [
        {
          text: [
            "Analyze this single product image for a brand content studio that will place the EXACT product into new scenes. Return JSON:",
            "- subject: the product in a short phrase.",
            "- productType: a concrete product-category noun, e.g. 'door hanger sign', 'coffee mug', 'house number plaque', 'wall print'.",
            "- useContext: where this product actually lives / is used / installed / displayed in real life — one short phrase, e.g. 'hangs on a door handle or knob', 'mounted beside a front door', 'sits on a desk', 'hung on a wall'. Infer from the product type, not just this photo.",
            "- sceneProps: name, as a short NOUN phrase, anything visible in THIS photo that is a prop, mount, hand, stand or surface and is NOT part of the product itself, e.g. 'a door handle', 'a wooden display stand', 'a hand'. Use an empty string if the product is shown alone on a plain background.",
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
  },
};
