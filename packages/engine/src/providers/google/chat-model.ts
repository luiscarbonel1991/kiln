import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { assertModel } from "@/domain/model-defaults";
import { chatModel } from "@/providers/chat-model";
import { ProviderKeyMissing } from "@/providers/errors";
import type { ChatModels } from "@/providers/interfaces";
import { env } from "../../env";

// Google's text models for the chat, thinking kept low like the other text
// calls.
let provider: GoogleGenerativeAIProvider | null = null;

export const googleChatModels: ChatModels = {
  model(id) {
    const model = assertModel({ provider: "google", model: id }, "text").id;
    if (!env.GOOGLE_API_KEY) throw new ProviderKeyMissing("google");
    provider ??= createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
    return chatModel(provider.languageModel(model), {
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
  },
};
