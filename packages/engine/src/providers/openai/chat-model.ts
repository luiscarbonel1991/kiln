import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { assertModel } from "@/domain/model-defaults";
import { chatModel } from "@/providers/chat-model";
import { ProviderKeyMissing } from "@/providers/errors";
import type { ChatModels } from "@/providers/interfaces";
import { env } from "../../env";

// OpenAI's text models for the chat, on the Responses API. Kiln keeps the
// conversation, so nothing is stored at OpenAI (the reasoning travels
// encrypted in it); reasoning is kept low like the other text calls.
let provider: OpenAIProvider | null = null;

export const openaiChatModels: ChatModels = {
  model(id) {
    const model = assertModel({ provider: "openai", model: id }, "text").id;
    if (!env.OPENAI_API_KEY) throw new ProviderKeyMissing("openai");
    provider ??= createOpenAI({ apiKey: env.OPENAI_API_KEY });
    return chatModel(provider.responses(model), {
      openai: {
        reasoningEffort: "low",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    });
  },
};
