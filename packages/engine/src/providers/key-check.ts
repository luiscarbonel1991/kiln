import type { ProviderId } from "@/domain/model-defaults";
import { describeProviderError } from "@/domain/queue";
import { env } from "../env";
import { checkGoogleKey } from "./google/key-check";
import { checkOpenAIKey } from "./openai/key-check";

// A provider's key, checked for free (Settings → Providers): the provider
// lists the models it reaches, no generation runs. `called` says whether a
// request went out, so only a real answer is kept as the provider's health.
export type KeyCheck =
  | { ok: true; called: true }
  | { ok: false; called: boolean; message: string };

const KEY_NAME: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

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
  const key = provider === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY;
  if (!key) {
    return {
      ok: false,
      called: false,
      message: `No API key — set ${KEY_NAME[provider]} in .env and restart Kiln.`,
    };
  }
  try {
    await (provider === "openai" ? checkOpenAIKey() : checkGoogleKey());
    return { ok: true, called: true };
  } catch (error) {
    return {
      ok: false,
      called: true,
      message: describeProviderError(provider, error),
    };
  }
}
