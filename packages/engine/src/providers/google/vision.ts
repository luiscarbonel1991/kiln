import { ThinkingLevel, Type } from "@google/genai";
import {
  DEFAULT_EFFORT,
  type Effort,
  effortOn,
  googleThinking,
  textTimeoutMs,
} from "@/domain/effort";
import { type TextCallKind, textBudget } from "@/domain/generation-cost";
import { assertModel } from "@/domain/model-defaults";
import { Treatment } from "@/domain/product";
import { BaseUnderstanding } from "@/domain/understanding";
import { fetchAsset } from "@/providers/asset-bytes";
import { ProviderKeyMissing } from "@/providers/errors";
import { getGenAI, hasGoogleKey, ONE_REQUEST } from "@/providers/google/client";
import { textUsage } from "@/providers/google/usage";
import type { TextCallOptions, VisionProvider } from "@/providers/interfaces";
import { mockSceneLook } from "@/providers/mock/scene-look";
import {
  MOCK_PRODUCT_DRAFT,
  MOCK_UNDERSTANDING,
} from "@/providers/mock/vision";
import { mockOutage, providerMode } from "@/providers/mode";
import {
  PRODUCT_DRAFT_PROMPT,
  ProductDraft,
  SCENE_LOOK_PROMPT,
  SceneLookAnswer,
  VISION_PROMPT,
  VisionAnswer,
} from "@/providers/text-prompts";

const THINKING = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

// What a Gemini text call is sent for its effort: the thinking level, the
// output cap (thinking included) and the time it may take, in one request.
export function geminiTextConfig(
  kind: TextCallKind,
  model: string,
  asked: Effort = DEFAULT_EFFORT,
) {
  const entry = { provider: "google", model };
  const effort = effortOn(entry, asked);
  return {
    maxOutputTokens: textBudget(kind, entry, effort).outputTokens,
    thinkingConfig: { thinkingLevel: THINKING[googleThinking(effort)] },
    httpOptions: { timeout: textTimeoutMs(effort) },
    ...ONE_REQUEST,
  };
}

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
      enum: [...Treatment.options],
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

const SCENE_LOOK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    plausible: { type: Type.BOOLEAN },
    problems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          what: { type: Type.STRING },
          where: { type: Type.STRING },
        },
        required: ["what", "where"],
      },
    },
  },
  required: ["plausible", "problems"],
};

// One photo, one paid request (no SDK retry), marked by `beforeCall`, bounded
// in time and output by its effort; the JSON answer parsed by `answer`.
async function askGemini<T>(
  assetUrl: string,
  options: TextCallOptions,
  ask: {
    kind: TextCallKind;
    prompt: string;
    schema: object;
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
      ...geminiTextConfig(ask.kind, options.model, options.effort),
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
// output by its effort; a failure throws (the caller says it degraded).
export const googleVisionProvider: VisionProvider = {
  async analyze(input, options) {
    const model = geminiTextModel(options.model);
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") {
        mockOutage("google");
        return { value: MOCK_UNDERSTANDING, model };
      }
      throw new ProviderKeyMissing("google");
    }
    return askGemini(
      input.assetUrl,
      { ...options, model },
      {
        kind: "vision",
        prompt: VISION_PROMPT,
        schema: VISION_SCHEMA,
        parse: (json) => BaseUnderstanding.parse(VisionAnswer.parse(json)),
      },
    );
  },
  async draftProduct(input, options) {
    const model = geminiTextModel(options.model);
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") {
        mockOutage("google");
        return { value: MOCK_PRODUCT_DRAFT, model };
      }
      throw new ProviderKeyMissing("google");
    }
    return askGemini(
      input.assetUrl,
      { ...options, model },
      {
        kind: "productDraft",
        prompt: PRODUCT_DRAFT_PROMPT,
        schema: PRODUCT_DRAFT_SCHEMA,
        parse: (json) => ProductDraft.parse(json),
      },
    );
  },
  async lookAtScene(input, options) {
    const model = geminiTextModel(options.model);
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") {
        mockOutage("google");
        return { value: mockSceneLook(), model };
      }
      throw new ProviderKeyMissing("google");
    }
    return askGemini(
      input.assetUrl,
      { ...options, model },
      {
        kind: "sceneLook",
        prompt: SCENE_LOOK_PROMPT,
        schema: SCENE_LOOK_SCHEMA,
        parse: (json) => SceneLookAnswer.parse(json),
      },
    );
  },
};
