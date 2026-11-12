import type { ProviderId } from "@/domain/model-defaults";
import { describeProviderError } from "@/domain/queue";
import { hasProviderKey } from "@/providers/keys";
import { env } from "../env";
import { checkGoogleKey } from "./google/key-check";
import { checkOpenAIKey } from "./openai/key-check";

// A provider's key, checked for free (Settings → Providers): the provider
// lists the models it reaches, no generation runs. `called` says whether a
// request went out, so only a real answer is kept as the provider's health;
// `models` are the ids it listed.
export type KeyCheck =
  | { ok: true; called: true; models: string[] }
  | { ok: false; called: boolean; message: string };

export async function checkProviderKey(
  provider: ProviderId,
): Promise<KeyCheck> {
  if (env.KILN_PROVIDERS === "mock") {
    return {
      ok: false,
      called: false,
      message: "Mock mode: nothing is called.",
    };
  }
  if (!hasProviderKey(provider)) {
    return {
      ok: false,
      called: false,
      message: "No API key: add one in Settings → Providers.",
    };
  }
  try {
    const models = await (provider === "openai"
      ? checkOpenAIKey()
      : checkGoogleKey());
    return { ok: true, called: true, models };
  } catch (error) {
    return {
      ok: false,
      called: true,
      message: describeProviderError(provider, error),
    };
  }
}
