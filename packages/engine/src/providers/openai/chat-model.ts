import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { DEFAULT_EFFORT, effortOn } from "@/domain/effort";
import { assertModel } from "@/domain/model-defaults";
import { chatModel } from "@/providers/chat-model";
import { ProviderKeyMissing } from "@/providers/errors";
import type { ChatModels } from "@/providers/interfaces";
import { env } from "../../env";

// OpenAI's text models for the chat, on the Responses API. Kiln keeps the
// conversation, so nothing is stored at OpenAI (the reasoning travels
// encrypted in it); the reasoning effort is the route's.
let provider: OpenAIProvider | null = null;

export const openaiChatModels: ChatModels = {
  model(id, effort = DEFAULT_EFFORT) {
    const model = assertModel({ provider: "openai", model: id }, "text").id;
    if (!env.OPENAI_API_KEY) throw new ProviderKeyMissing("openai");
    provider ??= createOpenAI({ apiKey: env.OPENAI_API_KEY });
    return chatModel(provider.responses(model), {
      openai: {
        reasoningEffort: effortOn({ provider: "openai", model }, effort),
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    });
  },
};
