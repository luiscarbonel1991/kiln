import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { DEFAULT_EFFORT, effortOn } from "@/domain/effort";
import { assertModel } from "@/domain/model-defaults";
import { chatModel } from "@/providers/chat-model";
import { ProviderKeyMissing } from "@/providers/errors";
import type { ChatModels } from "@/providers/interfaces";
import { providerKey } from "@/providers/keys";

// OpenAI's text models for the chat, on the Responses API. Kiln keeps the
// conversation, so nothing is stored at OpenAI (the reasoning travels
// encrypted in it); the reasoning effort is the route's.
let provider: { key: string; sdk: OpenAIProvider } | null = null;

export const openaiChatModels: ChatModels = {
  model(id, effort = DEFAULT_EFFORT) {
    const model = assertModel({ provider: "openai", model: id }, "text").id;
    const key = providerKey("openai");
    if (!key) throw new ProviderKeyMissing("openai");
    if (provider?.key !== key) {
      provider = { key, sdk: createOpenAI({ apiKey: key }) };
    }
    return chatModel(provider.sdk.responses(model), {
      openai: {
        reasoningEffort: effortOn({ provider: "openai", model }, effort),
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    });
  },
};
