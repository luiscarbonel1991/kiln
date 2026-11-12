import type { ProviderId } from "@/domain/model-defaults";
import { env } from "../env";

// A provider's API key (server only). The host may hand the engine a key the
// maker saved (Settings → Providers); it wins over the environment's, which
// stays the way for headless runs. Kept on globalThis so every copy of this
// module in a process reads the same keys.
type Saved = Partial<Record<ProviderId, string>>;
const store = globalThis as typeof globalThis & { __kilnProviderKeys?: Saved };
const saved = (): Saved => {
  store.__kilnProviderKeys ??= {};
  return store.__kilnProviderKeys;
};

const fromEnv = (provider: ProviderId) =>
  provider === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY;

export function providerKey(provider: ProviderId): string | undefined {
  return saved()[provider] ?? fromEnv(provider);
}

export function setProviderKey(provider: ProviderId, key: string | null): void {
  if (key) saved()[provider] = key;
  else delete saved()[provider];
}

// Where the key in use comes from: saved by the maker, the environment, or
// nowhere.
export function providerKeySource(
  provider: ProviderId,
): "saved" | "env" | null {
  if (saved()[provider]) return "saved";
  return fromEnv(provider) ? "env" : null;
}

// Whether a provider has a key, whatever the mode: the queue refuses a live
// job a provider cannot run, and provider health shows it.
export function hasProviderKey(provider: ProviderId): boolean {
  return Boolean(providerKey(provider));
}
