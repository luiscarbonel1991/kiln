import { ThinkingLevel, Type } from "@google/genai";
import { TEXT_CALL_BUDGETS } from "@/domain/generation-cost";
import { assertModel } from "@/domain/model-defaults";
import { BaseUnderstanding } from "@/domain/understanding";
import { fetchAsset } from "@/providers/asset-bytes";
import { ProviderKeyMissing } from "@/providers/errors";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import { textUsage } from "@/providers/google/usage";
import type { VisionProvider } from "@/providers/interfaces";
import {
  MOCK_PRODUCT_DRAFT,
  MOCK_UNDERSTANDING,
} from "@/providers/mock/vision";
import { providerMode } from "@/providers/mode";
import {
  PRODUCT_DRAFT_PROMPT,
  ProductDraft,
  VISION_PROMPT,
  VisionAnswer,
} from "@/providers/text-prompts";

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

// The product draft in Gemini's schema dialect (the same fields as ProductDraft).
export const PRODUCT_DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    whatItIs: { type: Type.STRING },
    material: { type: Type.STRING },
    treatment: {
      type: Type.STRING,
      enum: ["raised", "inlaid", "engraved", "printed", "cut"],
    },
    colours: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, hex: { type: Type.STRING } },
        required: ["name", "hex"],
      },
    },
    wording: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          example: { type: Type.STRING },
        },
        required: ["label", "example"],
      },
    },
    useContext: { type: Type.STRING },
  },
  required: [
    "name",
    "whatItIs",
    "material",
    "treatment",
    "colours",
    "wording",
    "useContext",
  ],
};

// One photo, one paid request (no SDK retry), marked by `beforeCall`, bounded
// in time and output, thinking kept low; the JSON answer parsed by `answer`.
async function askGemini<T>(
  assetUrl: string,
  options: { model: string; beforeCall?: () => Promise<void> },
  ask: {
    prompt: string;
    schema: object;
    outputTokens: number;
    parse: (json: unknown) => T;
  },
) {
  const img = await fetchAsset(assetUrl);
  await options.beforeCall?.();
  const res = await getGenAI().models.generateContent({
    model: options.model,
    contents: [
      { text: ask.prompt },
      { inlineData: { mimeType: img.mime, data: img.base64 } },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: ask.schema,
      maxOutputTokens: ask.outputTokens,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      httpOptions: { timeout: TEXT_TIMEOUT_MS },
    },
  });
  return {
    value: ask.parse(JSON.parse(res.text ?? "{}")),
    model: options.model,
    usage: textUsage(res.usageMetadata),
  };
}

const geminiTextModel = (model: string) =>
  assertModel({ provider: "google", model }, "text").id;

// Gemini multimodal: reads the photo and returns a structured BaseUnderstanding.
// One paid request (no SDK retry), marked by `beforeCall`, bounded in time and
// output, thinking kept low; a failure throws (the caller says it degraded).
export const googleVisionProvider: VisionProvider = {
  async analyze(input, options) {
    const model = geminiTextModel(options.model);
    if (!hasGoogleKey()) {
      if (providerMode() === "mock")
        return { value: MOCK_UNDERSTANDING, model };
      throw new ProviderKeyMissing("google");
    }
    return askGemini(
      input.assetUrl,
      { ...options, model },
      {
        prompt: VISION_PROMPT,
        schema: VISION_SCHEMA,
        outputTokens: TEXT_CALL_BUDGETS.vision.outputTokens,
        parse: (json) => BaseUnderstanding.parse(VisionAnswer.parse(json)),
      },
    );
  },
  async draftProduct(input, options) {
    const model = geminiTextModel(options.model);
    if (!hasGoogleKey()) {
      if (providerMode() === "mock")
        return { value: MOCK_PRODUCT_DRAFT, model };
      throw new ProviderKeyMissing("google");
    }
    return askGemini(
      input.assetUrl,
      { ...options, model },
      {
        prompt: PRODUCT_DRAFT_PROMPT,
        schema: PRODUCT_DRAFT_SCHEMA,
        outputTokens: TEXT_CALL_BUDGETS.productDraft.outputTokens,
        parse: (json) => ProductDraft.parse(json),
      },
    );
  },
};
