import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderId } from "@/domain/model-defaults";
import { env } from "../env";

// A provider's API key (server only). The host runs each piece of work inside
// the keys of the maker it is for (withProviderKeys), so two makers on one
// instance never share a key, and inside a scope only the maker's own keys
// count. Outside one (a script, the CLI) the environment's key
// (OPENAI_API_KEY, GOOGLE_API_KEY) is used. The scope is kept on globalThis so every copy of this module in a
// process reads the same one. Beside each key it holds the id of the maker's
// key in use (when the host gives one), so a call can record the key it ran
// on; the two travel together.
export type ProviderKeys = Partial<Record<ProviderId, string>>;
export type ProviderKeyIds = Partial<Record<ProviderId, string>>;

interface KeyScope {
  keys: ProviderKeys;
  ids: ProviderKeyIds;
}

const store = globalThis as typeof globalThis & {
  __kilnProviderKeyScope?: AsyncLocalStorage<KeyScope>;
};
const scope = (): AsyncLocalStorage<KeyScope> => {
  store.__kilnProviderKeyScope ??= new AsyncLocalStorage<KeyScope>();
  return store.__kilnProviderKeyScope;
};

const fromEnv = (provider: ProviderId) =>
  provider === "openai" ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY;

// Run `work` with a maker's saved keys (and the ids of those keys);
// everything it starts, awaited or not, sees them.
export function withProviderKeys<T>(
  keys: ProviderKeys,
  work: () => T,
  ids: ProviderKeyIds = {},
): T {
  return scope().run({ keys: { ...keys }, ids: { ...ids } }, work);
}

// The keys in effect here, to carry into work that starts later from
// somewhere else (a stream read by the response, a callback).
export function currentProviderKeys(): ProviderKeys {
  return { ...scope().getStore()?.keys };
}

// The ids of the keys in effect here, carried with currentProviderKeys.
export function currentProviderKeyIds(): ProviderKeyIds {
  return { ...scope().getStore()?.ids };
}

export function providerKey(provider: ProviderId): string | undefined {
  const current = scope().getStore();
  return current ? current.keys[provider] : fromEnv(provider);
}

// The id of the maker's key in use for a provider; none outside a scope (the
// environment's key is no saved key) or when the host gave none.
export function providerKeyId(provider: ProviderId): string | undefined {
  return scope().getStore()?.ids[provider];
}

// Where the key in use comes from: saved by the maker, the environment (a
// script or the CLI), or nowhere.
export function providerKeySource(
  provider: ProviderId,
): "saved" | "env" | null {
  const current = scope().getStore();
  if (current) return current.keys[provider] ? "saved" : null;
  return fromEnv(provider) ? "env" : null;
}

// Whether this runs inside a maker's keys (the app) or outside any (a script,
// the CLI): only outside does the environment's key count.
export function inProviderKeyScope(): boolean {
  return scope().getStore() !== undefined;
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
