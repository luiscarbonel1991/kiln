import OpenAI from "openai";
import { ProviderKeyMissing } from "@/providers/errors";
import { providerKey } from "@/providers/keys";
import { env } from "../../env";

// The OpenAI client (server-only), built once per key: a key the maker
// replaces is used from the next call. hasOpenAIKey lets the adapter fall
// back to its mock when no key is configured.
let client: { key: string; sdk: OpenAI } | null = null;

export function hasOpenAIKey(): boolean {
  return env.KILN_PROVIDERS !== "mock" && Boolean(providerKey("openai"));
}

export function getOpenAI(): OpenAI {
  const key = providerKey("openai");
  if (!key) throw new ProviderKeyMissing("openai");
  if (client?.key !== key) client = { key, sdk: new OpenAI({ apiKey: key }) };
  return client.sdk;
}
