import { Type } from "@google/genai";
import { assertModel } from "@/domain/model-defaults";
import { ProviderKeyMissing } from "@/providers/errors";
import { getGenAI, hasGoogleKey } from "@/providers/google/client";
import { textUsage } from "@/providers/google/usage";
import { geminiTextConfig } from "@/providers/google/vision";
import type { ArtDirector } from "@/providers/interfaces";
import {
  fallbackVariants,
  mockListingCopy,
  mockProductReview,
} from "@/providers/mock/art-director";
import { mockOutage, providerMode } from "@/providers/mode";
import {
  artDirectionPrompt,
  DirectionsAnswer,
  ListingCopy,
  listingCopyPrompt,
  ProductReview,
  pinToSlots,
  productReviewPrompt,
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

// A product review in Gemini's schema dialect (the same as ProductReview).
export const PRODUCT_REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          value: { type: Type.STRING },
          why: { type: Type.STRING },
        },
        required: ["field", "value", "why"],
      },
    },
    checks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          why: { type: Type.STRING },
        },
        required: ["field", "why"],
      },
    },
  },
  required: ["suggestions", "checks"],
};

// Gemini text art director: a diverse scene/composition/lighting per listing
// slot, serving each slot's commercial purpose. One paid request, marked by
// `beforeCall`; a failure throws (the caller offers the recipe's directions or
// the other provider, never a silent stand-in).
export const googleArtDirector: ArtDirector = {
  async reviewProduct({ fields }, options) {
    const model = assertModel(
      { provider: "google", model: options.model },
      "text",
    ).id;
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") {
        mockOutage("google");
        return { value: mockProductReview(fields), model };
      }
      throw new ProviderKeyMissing("google");
    }
    await options.beforeCall?.();
    const res = await getGenAI().models.generateContent({
      model,
      contents: [{ text: productReviewPrompt(fields) }],
      config: {
        responseMimeType: "application/json",
        responseSchema: PRODUCT_REVIEW_SCHEMA,
        ...geminiTextConfig("productReview", model, options.effort),
      },
    });
    return {
      value: ProductReview.parse(JSON.parse(res.text ?? "{}")),
      model,
      usage: textUsage(res.usageMetadata),
    };
  },
  async writeListing(input, options) {
    const model = assertModel(
      { provider: "google", model: options.model },
      "text",
    ).id;
    if (!hasGoogleKey()) {
      if (providerMode() === "mock") {
        mockOutage("google");
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
        ...geminiTextConfig("listingCopy", model, options.effort),
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
      if (providerMode() === "mock") {
        mockOutage("google");
        return { value: fill, model };
      }
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
        ...geminiTextConfig("artDirection", model, options.effort),
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
