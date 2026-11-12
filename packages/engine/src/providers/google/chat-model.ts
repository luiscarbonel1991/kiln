import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { DEFAULT_EFFORT, effortOn, googleThinking } from "@/domain/effort";
import { assertModel } from "@/domain/model-defaults";
import { chatModel } from "@/providers/chat-model";
import { ProviderKeyMissing } from "@/providers/errors";
import type { ChatModels } from "@/providers/interfaces";
import { providerKey } from "@/providers/keys";

// Google's text models for the chat, thinking at the route's effort.
let provider: { key: string; sdk: GoogleGenerativeAIProvider } | null = null;

export const googleChatModels: ChatModels = {
  model(id, effort = DEFAULT_EFFORT) {
    const model = assertModel({ provider: "google", model: id }, "text").id;
    const key = providerKey("google");
    if (!key) throw new ProviderKeyMissing("google");
    if (provider?.key !== key) {
      provider = { key, sdk: createGoogleGenerativeAI({ apiKey: key }) };
    }
    const thinkingLevel = googleThinking(
      effortOn({ provider: "google", model }, effort),
    );
    return chatModel(provider.sdk.languageModel(model), {
      google: { thinkingConfig: { thinkingLevel } },
    });
  },
};
