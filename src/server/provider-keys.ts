import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import {
  hasEnvironmentKey,
  type ProviderKeys,
  providerKeySource,
  withProviderKeys,
} from "@/providers/keys";
import { hasSecretKey, seal, unseal } from "@/server/secret-box";

// The provider keys each maker saved in Settings → Providers: sealed in the
// database, handed to the engine per piece of work (withMakerKeys), never
// sent back to the browser. They are the only keys the app uses; the
// environment's (OPENAI_API_KEY, GOOGLE_API_KEY) serve scripts and the CLI.

const PROVIDERS: ProviderId[] = ["openai", "google"];
const purpose = (provider: ProviderId) => `provider-key:${provider}`;

export interface ProviderKeyState {
  provider: ProviderId;
  // Where the key in use comes from; null when there is none.
  source: "saved" | "env" | null;
  // The saved key's last four characters.
  hint: string | null;
  // A key is saved but cannot be read (KILN_SECRET_KEY is missing or changed).
  unreadable: boolean;
  // The environment holds a key for this provider, which the app does not
  // use: it has to be saved here.
  inEnvironment: boolean;
}

// Each maker's keys, read once and unsealed in memory; saving or removing a
// key drops that maker's entry, and a failed read is tried again.
const cache = globalThis as typeof globalThis & {
  __kilnMakerKeys?: Map<string, Promise<ProviderKeys>>;
};
const loaded = () => {
  cache.__kilnMakerKeys ??= new Map();
  return cache.__kilnMakerKeys;
};

async function read(makerId: string): Promise<ProviderKeys> {
  const rows = await db.providerKey.findMany({ where: { makerId } });
  const keys: ProviderKeys = {};
  for (const row of rows) {
    const provider = row.provider as ProviderId;
    if (!PROVIDERS.includes(provider)) continue;
    try {
      keys[provider] = unseal(row.sealed, purpose(provider));
    } catch {
      // KILN_SECRET_KEY is missing or changed: the key reads as unreadable.
    }
  }
  return keys;
}

export function makerProviderKeys(makerId: string): Promise<ProviderKeys> {
  if (!hasDatabase()) return Promise.resolve({});
  const keys = loaded();
  let pending = keys.get(makerId);
  if (!pending) {
    pending = read(makerId).catch((error) => {
      keys.delete(makerId);
      throw error;
    });
    keys.set(makerId, pending);
  }
  return pending;
}

const forget = (makerId: string) => loaded().delete(makerId);

// Run `work` with this maker's saved keys, and no other maker's.
export async function withMakerKeys<T>(
  makerId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withProviderKeys(await makerProviderKeys(makerId), work);
}

export async function providerKeyStates(
  makerId: string,
): Promise<ProviderKeyState[]> {
  const rows = hasDatabase()
    ? await db.providerKey.findMany({ where: { makerId } })
    : [];
  const keys = await makerProviderKeys(makerId);
  return withProviderKeys(keys, () =>
    PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider);
      const source = providerKeySource(provider);
      return {
        provider,
        source,
        hint: row?.hint ?? null,
        unreadable: Boolean(row) && source !== "saved",
        inEnvironment: hasEnvironmentKey(provider),
      };
    }),
  );
}

// What a pasted key must look like before it is kept: one line, no spaces,
// long enough to be a key. Whether the provider takes it is the free check's
// answer, right after.
export function keyProblem(key: string): string | null {
  if (key.length < 20) return "That is too short to be an API key.";
  if (key.length > 400) return "That is too long to be an API key.";
  if (/\s/.test(key)) return "An API key has no spaces or line breaks.";
  return null;
}

export async function saveProviderKey(
  makerId: string,
  provider: ProviderId,
  raw: string,
): Promise<void> {
  assertDatabaseUrl();
  const key = raw.trim();
  const problem = keyProblem(key);
  if (problem) throw new Error(problem);
  if (!hasSecretKey()) {
    throw new Error(
      `Kiln has no KILN_SECRET_KEY to keep the ${PROVIDER_LABELS[provider]} key sealed: add one to .env (openssl rand -base64 32) and restart Kiln.`,
    );
  }
  const data = { sealed: seal(key, purpose(provider)), hint: key.slice(-4) };
  await db.providerKey.upsert({
    where: { makerId_provider: { makerId, provider } },
    create: { makerId, provider, ...data },
    update: data,
  });
  forget(makerId);
}

export async function removeProviderKey(
  makerId: string,
  provider: ProviderId,
): Promise<void> {
  assertDatabaseUrl();
  await db.providerKey.deleteMany({ where: { makerId, provider } });
  forget(makerId);
}
