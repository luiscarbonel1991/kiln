import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import { providerKeySource, setProviderKey } from "@/providers/keys";
import { getCurrentMaker } from "@/server/maker-repository";
import { hasSecretKey, seal, unseal } from "@/server/secret-box";

// The provider keys the maker saved in Settings → Providers: sealed in the
// database, handed to the engine in memory, never sent back to the browser.
// A saved key wins over the environment's (OPENAI_API_KEY, GOOGLE_API_KEY),
// which stays the way for headless runs and for anyone who prefers .env.

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
}

const cache = globalThis as typeof globalThis & {
  __kilnProviderKeysLoaded?: Promise<void>;
};

async function load(): Promise<void> {
  if (!hasDatabase()) return;
  const maker = await getCurrentMaker();
  const rows = await db.providerKey.findMany({ where: { makerId: maker.id } });
  for (const provider of PROVIDERS) {
    const row = rows.find((r) => r.provider === provider);
    let key: string | null = null;
    if (row) {
      try {
        key = unseal(row.sealed, purpose(provider));
      } catch {
        key = null;
      }
    }
    setProviderKey(provider, key);
  }
}

// Hand the saved keys to the engine, once per process (the server's start and
// anything that reads a key's state); a failed read is tried again.
export function ensureProviderKeys(): Promise<void> {
  cache.__kilnProviderKeysLoaded ??= load().catch((error) => {
    cache.__kilnProviderKeysLoaded = undefined;
    throw error;
  });
  return cache.__kilnProviderKeysLoaded;
}

export async function providerKeyStates(): Promise<ProviderKeyState[]> {
  const rows = hasDatabase()
    ? await ensureProviderKeys().then(async () => {
        const maker = await getCurrentMaker();
        return db.providerKey.findMany({ where: { makerId: maker.id } });
      })
    : [];
  return PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const source = providerKeySource(provider);
    return {
      provider,
      source,
      hint: row?.hint ?? null,
      unreadable: Boolean(row) && source !== "saved",
    };
  });
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
  const maker = await getCurrentMaker();
  const data = { sealed: seal(key, purpose(provider)), hint: key.slice(-4) };
  await db.providerKey.upsert({
    where: { makerId_provider: { makerId: maker.id, provider } },
    create: { makerId: maker.id, provider, ...data },
    update: data,
  });
  setProviderKey(provider, key);
}

export async function removeProviderKey(provider: ProviderId): Promise<void> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  await db.providerKey.deleteMany({ where: { makerId: maker.id, provider } });
  setProviderKey(provider, null);
}
