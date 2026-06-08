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
          text: "Analyze this single product image for a brand content studio so it can drive downstream image generation. Return JSON: subject, materials, lighting, composition, mood (each a short phrase) and palette (3-6 dominant colors as hex strings like #aabbcc).",
        },
        { inlineData: { mimeType: img.mime, data: img.base64 } },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            materials: { type: Type.STRING },
            lighting: { type: Type.STRING },
            composition: { type: Type.STRING },
            mood: { type: Type.STRING },
            palette: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            "subject",
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
