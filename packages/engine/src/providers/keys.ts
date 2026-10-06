import type { ProviderId } from "@/domain/model-defaults";
import { env } from "../env";

// Whether a provider's API key is set (server only), whatever the mode: the
// queue refuses a live job a provider cannot run, and provider health shows it.
export function hasProviderKey(provider: ProviderId): boolean {
  return Boolean(
    provider === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY,
  );
}
