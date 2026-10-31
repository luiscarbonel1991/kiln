import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { DEFAULT_EFFORT, effortOn, googleThinking } from "@/domain/effort";
import { assertModel } from "@/domain/model-defaults";
import { chatModel } from "@/providers/chat-model";
import { ProviderKeyMissing } from "@/providers/errors";
import type { ChatModels } from "@/providers/interfaces";
import { env } from "../../env";

// Google's text models for the chat, thinking at the route's effort.
let provider: GoogleGenerativeAIProvider | null = null;

export const googleChatModels: ChatModels = {
  model(id, effort = DEFAULT_EFFORT) {
    const model = assertModel({ provider: "google", model: id }, "text").id;
    if (!env.GOOGLE_API_KEY) throw new ProviderKeyMissing("google");
    provider ??= createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
    const thinkingLevel = googleThinking(
      effortOn({ provider: "google", model }, effort),
    );
    return chatModel(provider.languageModel(model), {
      google: { thinkingConfig: { thinkingLevel } },
    });
  },
};
