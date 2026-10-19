import { ThinkingLevel, Type } from "@google/genai";
import { TEXT_CALL_BUDGETS } from "@/domain/generation-cost";
import { assertModel } from "@/domain/model-defaults";
import { ProviderKeyMissing } from "@/providers/errors";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import { textUsage } from "@/providers/google/usage";
import { TEXT_TIMEOUT_MS } from "@/providers/google/vision";
import type { ArtDirector } from "@/providers/interfaces";
import {
  fallbackVariants,
  mockListingCopy,
} from "@/providers/mock/art-director";
import { providerMode } from "@/providers/mode";
import {
  artDirectionPrompt,
  DirectionsAnswer,
  ListingCopy,
  listingCopyPrompt,
  pinToSlots,
} from "@/providers/text-prompts";

// The answer shape in Gemini's schema dialect (the same as DirectionsAnswer).
export const DIRECTIONS_SCHEMA = {
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
};

// A listing's prose in Gemini's schema dialect (the same as ListingCopy).
export const LISTING_COPY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    materials: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["title", "description", "tags", "materials"],
};

// Gemini text art director: a diverse scene/composition/lighting per listing
// slot, serving each slot's commercial purpose. One paid request, marked by
// `beforeCall`; a failure throws (the caller offers the recipe's directions or
// the other provider, never a silent stand-in).
export const googleArtDirector: ArtDirector = {
  async writeListing(input, options) {
    const model = assertModel(
      { provider: "google", model: options.model },
      "text",
    ).id;
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") {
        return { value: mockListingCopy(input.draft), model };
      }
      throw new ProviderKeyMissing("google");
    }
    await options.beforeCall?.();
    const res = await getGenAI().models.generateContent({
      model,
      contents: [{ text: listingCopyPrompt(input) }],
      config: {
        responseMimeType: "application/json",
        responseSchema: LISTING_COPY_SCHEMA,
        maxOutputTokens: TEXT_CALL_BUDGETS.listingCopy.outputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { timeout: TEXT_TIMEOUT_MS },
      },
    });
    return {
      value: ListingCopy.parse(JSON.parse(res.text ?? "{}")),
      model,
      usage: textUsage(res.usageMetadata),
    };
  },
  async proposeDirections({ understanding, recipe, brand, n }, options) {
    const model = assertModel(
      { provider: "google", model: options.model },
      "text",
    ).id;
    const fill = fallbackVariants(recipe, understanding, n);
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") return { value: fill, model };
      throw new ProviderKeyMissing("google");
    }
    const slots = recipe.directions.slice(0, n);
    await options.beforeCall?.();
    const res = await getGenAI().models.generateContent({
      model,
      contents: [{ text: artDirectionPrompt(understanding, brand, slots) }],
      config: {
        responseMimeType: "application/json",
        responseSchema: DIRECTIONS_SCHEMA,
        maxOutputTokens: TEXT_CALL_BUDGETS.artDirection.outputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: { timeout: TEXT_TIMEOUT_MS },
      },
    });
    const answer = DirectionsAnswer.parse(JSON.parse(res.text ?? "{}"));
    return {
      value: pinToSlots(answer.variants, slots, fill),
      model,
      usage: textUsage(res.usageMetadata),
    };
  },
};
