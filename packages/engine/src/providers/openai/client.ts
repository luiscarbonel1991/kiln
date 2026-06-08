import OpenAI from "openai";
import { env } from "../../env";

// Lazily-constructed singleton OpenAI client (server-only). hasOpenAIKey lets the
// adapter fall back to its mock when no key is configured.
let client: OpenAI | null = null;

export function hasOpenAIKey(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

export function getOpenAI(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}
