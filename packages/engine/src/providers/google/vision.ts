import { ThinkingLevel, Type } from "@google/genai";
import { TEXT_CALL_BUDGETS } from "@/domain/generation-cost";
import { assertModel } from "@/domain/model-defaults";
import { BaseUnderstanding } from "@/domain/understanding";
import { fetchAsset } from "@/providers/asset-bytes";
import { ProviderKeyMissing } from "@/providers/errors";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import { textUsage } from "@/providers/google/usage";
import type { VisionProvider } from "@/providers/interfaces";
import { MOCK_UNDERSTANDING } from "@/providers/mock/vision";
import { providerMode } from "@/providers/mode";
import { VISION_PROMPT, VisionAnswer } from "@/providers/text-prompts";

// A text call's bound (it reads one photo and writes a short JSON).
export const TEXT_TIMEOUT_MS = 60_000;

// The answer shape in Gemini's schema dialect (the same fields as VisionAnswer).
export const VISION_SCHEMA = {
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
};

// Gemini multimodal: reads the photo and returns a structured BaseUnderstanding.
// One paid request (no SDK retry), marked by `beforeCall`, bounded in time and
// output, thinking kept low; a failure throws (the caller says it degraded).
export const googleVisionProvider: VisionProvider = {
  async analyze(input, options) {
    const model = assertModel(
      { provider: "google", model: options.model },
      "text",
    ).id;
    if (!hasGoogleKey()) {
      if (providerMode() === "mock")
        return { value: MOCK_UNDERSTANDING, model };
      throw new ProviderKeyMissing("google");
    }
    const img = await fetchAsset(input.assetUrl);
    await options.beforeCall?.();
    const res = await getGenAI().models.generateContent({
      model,
      contents: [
        { text: VISION_PROMPT },
        { inlineData: { mimeType: img.mime, data: img.base64 } },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: VISION_SCHEMA,
        maxOutputTokens: TEXT_CALL_BUDGETS.vision.outputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { timeout: TEXT_TIMEOUT_MS },
      },
    });
    const answer = VisionAnswer.parse(JSON.parse(res.text ?? "{}"));
    return {
      value: BaseUnderstanding.parse(answer),
      model,
      usage: textUsage(res.usageMetadata),
    };
  },
};
