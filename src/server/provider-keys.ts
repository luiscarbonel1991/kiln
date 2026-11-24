import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { assertDatabaseUrl, db, hasDatabase } from "@/lib/db";
import {
  type AccessRow,
  type KeyRow,
  type PickedKey,
  pickProviderKeys,
} from "@/lib/provider-key-pick";
import {
  hasEnvironmentKey,
  type ProviderKeyIds,
  type ProviderKeys,
  providerKeySource,
  withProviderKeys,
} from "@/providers/keys";
import type { MakerRef } from "@/server/maker-repository";
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

// A studio's keys as the lookup reads them: every key row unsealed (null when
// it cannot be read), who each key is given to, and which of those people
// are on the studio's team.
interface StudioKeys {
  keys: KeyRow[];
  access: AccessRow[];
  people: string[];
}

// Each studio's keys, read once and unsealed in memory, keyed by the maker's
// id only; the key a caller runs on is picked per call from that one entry
// (pickProviderKeys), so the cache never hands one person's key to another.
// Every write of a studio's keys drops its entry, and a failed read is tried
// again. The cache is per server process: Kiln runs one (the worker lives in
// it); a second process would keep its own entry until its next read after a
// write of its own.
const cache = globalThis as typeof globalThis & {
  __kilnStudioKeys?: Map<string, Promise<StudioKeys>>;
};
const loaded = () => {
  cache.__kilnStudioKeys ??= new Map();
  return cache.__kilnStudioKeys;
};

async function read(maker: MakerRef): Promise<StudioKeys> {
  const rows = await db.providerKey.findMany({
    where: { makerId: maker.id },
  });
  const access = await db.providerKeyAccess.findMany({
    where: { makerId: maker.id },
  });
  // An access row counts only for someone on this studio's team.
  const named = [...new Set(access.map((a) => a.memberId))];
  const people =
    named.length === 0
      ? []
      : await db.member.findMany({
          where: {
            id: { in: named },
            organization: { maker: { is: { id: maker.id } } },
          },
          select: { id: true },
        });
  const keys: KeyRow[] = [];
  for (const row of rows) {
    const provider = row.provider as ProviderId;
    if (!PROVIDERS.includes(provider)) continue;
    let secret: string | null = null;
    try {
      secret = unseal(row.sealed, purpose(provider));
    } catch {
      // KILN_SECRET_KEY is missing or changed: the key reads as unreadable.
    }
    keys.push({ id: row.id, provider, forTeam: row.forTeam, secret });
  }
  return {
    keys,
    access: access.flatMap((a) =>
      PROVIDERS.includes(a.provider as ProviderId)
        ? [
            {
              keyId: a.keyId,
              memberId: a.memberId,
              provider: a.provider as ProviderId,
            },
          ]
        : [],
    ),
    people: people.map((p) => p.id),
  };
}

const NO_KEYS: StudioKeys = { keys: [], access: [], people: [] };

function studioKeys(maker: MakerRef): Promise<StudioKeys> {
  if (!hasDatabase()) return Promise.resolve(NO_KEYS);
  const entries = loaded();
  let pending = entries.get(maker.id);
  if (!pending) {
    pending = read(maker).catch((error) => {
      entries.delete(maker.id);
      throw error;
    });
    entries.set(maker.id, pending);
  }
  return pending;
}

const forget = (makerId: string) => loaded().delete(makerId);

// The key each provider gives this caller: the person's own, else the
// team's (a token, with no person, the team's only).
async function picked(maker: MakerRef) {
  return pickProviderKeys({
    ...(await studioKeys(maker)),
    memberId: maker.member?.id ?? null,
  });
}

// Run `work` with this caller's keys, and no one else's: the person's own or
// the team's, per provider, with the id of each key in use.
export async function withMakerKeys<T>(
  maker: MakerRef,
  work: () => Promise<T>,
): Promise<T> {
  const keys: ProviderKeys = {};
  const ids: ProviderKeyIds = {};
  for (const [provider, pick] of Object.entries(await picked(maker))) {
    if (!pick.key) continue;
    keys[provider as ProviderId] = pick.key.secret;
    ids[provider as ProviderId] = pick.key.id;
  }
  return withProviderKeys(keys, work, ids);
}

// Whether each provider has a key this caller can use, and whose it is: no
// id, name or last four, so it may reach any reader's words.
export async function providerReach(
  maker: MakerRef,
): Promise<Record<ProviderId, Pick<PickedKey, "reach" | "whose">>> {
  const picks = await picked(maker);
  return {
    openai: { reach: picks.openai.reach, whose: picks.openai.whose },
    google: { reach: picks.google.reach, whose: picks.google.whose },
  };
}

export async function providerKeyStates(
  maker: MakerRef,
): Promise<ProviderKeyState[]> {
  const rows = hasDatabase()
    ? await db.providerKey.findMany({
        where: { makerId: maker.id, forTeam: true },
      })
    : [];
  // Today's form manages each provider's team key: the one a token runs on.
  const team = await picked({ id: maker.id });
  const keys: ProviderKeys = {};
  for (const provider of PROVIDERS) {
    const key = team[provider].key;
    if (key) keys[provider] = key.secret;
  }
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
  maker: MakerRef,
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
  // The form writes the provider's team key: replaced in place, or made.
  await db.$transaction(async (tx) => {
    const team = await tx.providerKey.findFirst({
      where: { makerId: maker.id, provider, forTeam: true },
      select: { id: true },
    });
    if (team) {
      await tx.providerKey.update({ where: { id: team.id }, data });
    } else {
      await tx.providerKey.create({
        data: {
          makerId: maker.id,
          provider,
          name: "Team key",
          forTeam: true,
          ...data,
        },
      });
    }
  });
  forget(maker.id);
}

export async function removeProviderKey(
  maker: MakerRef,
  provider: ProviderId,
): Promise<void> {
  assertDatabaseUrl();
  await db.providerKey.deleteMany({
    where: { makerId: maker.id, provider, forTeam: true },
  });
  forget(maker.id);
}
