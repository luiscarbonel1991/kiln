import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderId } from "@/domain/model-defaults";
import { env } from "../env";

// A provider's API key (server only). The host runs each piece of work inside
// the keys of the maker it is for (withProviderKeys), so two makers on one
// instance never share a key, and inside a scope only the maker's own keys
// count. Outside one (a script, the CLI) the environment's key
// (OPENAI_API_KEY, GOOGLE_API_KEY) is used. The scope is kept on globalThis so every copy of this module in a
// process reads the same one.
export type ProviderKeys = Partial<Record<ProviderId, string>>;

const store = globalThis as typeof globalThis & {
  __kilnProviderKeyScope?: AsyncLocalStorage<ProviderKeys>;
};
const scope = (): AsyncLocalStorage<ProviderKeys> => {
  store.__kilnProviderKeyScope ??= new AsyncLocalStorage<ProviderKeys>();
  return store.__kilnProviderKeyScope;
};

const fromEnv = (provider: ProviderId) =>
  provider === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY;

// Run `work` with a maker's saved keys; everything it starts, awaited or not,
// sees them.
export function withProviderKeys<T>(keys: ProviderKeys, work: () => T): T {
  return scope().run({ ...keys }, work);
}

// The keys in effect here, to carry into work that starts later from
// somewhere else (a stream read by the response, a callback).
export function currentProviderKeys(): ProviderKeys {
  return { ...scope().getStore() };
}

export function providerKey(provider: ProviderId): string | undefined {
  const keys = scope().getStore();
  return keys ? keys[provider] : fromEnv(provider);
}

// Where the key in use comes from: saved by the maker, the environment (a
// script or the CLI), or nowhere.
export function providerKeySource(
  provider: ProviderId,
): "saved" | "env" | null {
  const keys = scope().getStore();
  if (keys) return keys[provider] ? "saved" : null;
  return fromEnv(provider) ? "env" : null;
}

// Whether the environment holds a key the app will not use, so Settings can
// say where it has to go.
export function hasEnvironmentKey(provider: ProviderId): boolean {
  return Boolean(fromEnv(provider));
}

// Whether a provider has a key, whatever the mode: the queue refuses a live
// job a provider cannot run, and provider health shows it.
export function hasProviderKey(provider: ProviderId): boolean {
  return Boolean(providerKey(provider));
}
