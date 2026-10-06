import { BaseUnderstanding } from "@/domain/understanding";
import { fetchAsset } from "@/providers/asset-bytes";
import type { VisionProvider } from "@/providers/interfaces";
import { MOCK_UNDERSTANDING } from "@/providers/mock/vision";
import { askOpenAI, openaiTextModel } from "@/providers/openai/text";
import { VISION_PROMPT, VisionAnswer } from "@/providers/text-prompts";

// OpenAI vision: the same question and answer shape as Gemini's, the photo
// sent inline; a failure throws (the caller says it degraded).
export const openaiVisionProvider: VisionProvider = {
  async analyze(input, options) {
    const model = openaiTextModel(options.model);
    if (model.mock) return { value: MOCK_UNDERSTANDING, model: model.id };
    const img = await fetchAsset(input.assetUrl);
    const answer = await askOpenAI({
      model: model.id,
      kind: "vision",
      name: "understanding",
      schema: VisionAnswer,
      content: [
        { type: "input_text", text: VISION_PROMPT },
        {
          type: "input_image",
          image_url: `data:${img.mime};base64,${img.base64}`,
          detail: "high",
        },
      ],
      beforeCall: options.beforeCall,
    });
    return {
      value: BaseUnderstanding.parse(answer.value),
      model: model.id,
      usage: answer.usage,
    };
  },
};
