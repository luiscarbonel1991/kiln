import type { ArtDirector } from "@/providers/interfaces";
import { fallbackVariants } from "@/providers/mock/art-director";
import { askOpenAI, openaiTextModel } from "@/providers/openai/text";
import {
  artDirectionPrompt,
  DirectionsAnswer,
  pinToSlots,
} from "@/providers/text-prompts";

// OpenAI art director: the same prompt and answer shape as Gemini's; a
// failure throws (the caller offers the recipe's directions or the other
// provider, never a silent stand-in).
export const openaiArtDirector: ArtDirector = {
  async proposeDirections({ understanding, recipe, brand, n }, options) {
    const model = openaiTextModel(options.model);
    const fill = fallbackVariants(recipe, understanding, n);
    if (model.mock) return { value: fill, model: model.id };
    const slots = recipe.directions.slice(0, n);
    const answer = await askOpenAI({
      model: model.id,
      kind: "artDirection",
      name: "directions",
      schema: DirectionsAnswer,
      content: [
        {
          type: "input_text",
          text: artDirectionPrompt(understanding, brand, slots),
        },
      ],
      beforeCall: options.beforeCall,
    });
    return {
      value: pinToSlots(answer.value.variants, slots, fill),
      model: model.id,
      usage: answer.usage,
    };
  },
};
