import {
  PROVIDER_LABELS,
  type ProviderId,
  unlistedModels,
} from "@/domain/model-defaults";
import { isKeyRejectedText, readableFailure } from "@/domain/queue";
import { db, hasDatabase } from "@/lib/db";
import { checkProviderKey, type KeyCheck } from "@/providers/key-check";
import { hasProviderKey, providerKeyId } from "@/providers/keys";
import {
  readUnlisted,
  recordKeyCheck,
  type UnlistedModels,
} from "@/server/generation-repository";
import { CAP_REACHED, NOT_RUN, NOT_STARTED } from "@/server/generation-worker";
import type { MakerRef } from "@/server/maker-repository";
import { providerReach, withKey } from "@/server/provider-keys";

// Each provider's health, free to read (no ping, no paid call): whether the
// reader has a key, and what the last live calls on it did — the queue's jobs and the
// direct calls (vision, art direction, the studio) all leave a row. The last
// error shows until a later call succeeds. A move down a route counts as a
// failure of the provider it left. Kiln's own refusals (the month's cap, a
// canceled job, every "Not run: " of a job that never reached the provider)
// are not the provider's and are skipped.

export interface ProviderHealth {
  provider: ProviderId;
  label: string;
  keyPresent: boolean;
  lastError: { at: string; message: string } | null;
  // The last error is the provider rejecting the key: no call can work until
  // it is replaced (and checked again in Settings → Providers).
  keyRejected: boolean;
  lastOkAt: string | null;
  // The offered models its latest key check found it no longer lists.
  unlisted: { models: string[]; at: string } | null;
}

const PROVIDERS: ProviderId[] = ["openai", "google"];

// One provider's last outcomes on one key: `key` is the key's id, "" for a
// call from before keys were recorded (it counts for the team key), and null
// for a move made because no key was in reach (it counts for none).
interface Outcome {
  provider: string | null;
  key: string | null;
  status: string;
  at: Date;
  error: string | null;
}

async function lastOutcomes(maker: MakerRef): Promise<Outcome[]> {
  return db.$queryRaw<Outcome[]>`
    SELECT DISTINCT ON ("provider", "key", "status")
           "provider", "key", "status", "at", "error"
    FROM (
      SELECT COALESCE("request" #>> '{model,provider}', "request" ->> 'provider')
               AS "provider",
             COALESCE("providerKeyId", '') AS "key",
             "status", "finishedAt" AS "at", "error"
      FROM "GenerationJob"
      WHERE "makerId" = ${maker.id}
        AND "mode" = 'live'
        AND "finishedAt" IS NOT NULL
        AND ("status" = 'done'
             OR ("status" = 'failed' AND "error" IS NOT NULL
                 AND "error" NOT IN (${CAP_REACHED}, ${NOT_STARTED})
                 AND "error" NOT LIKE ${`${NOT_RUN}%`}))
      UNION ALL
      SELECT s #>> '{from,provider}',
             CASE WHEN s -> 'keyId' IS NULL THEN '' ELSE s ->> 'keyId' END,
             'failed', (s ->> 'at')::timestamptz, s ->> 'reason'
      FROM "GenerationJob", jsonb_array_elements("route" -> 'switched') AS s
      WHERE "makerId" = ${maker.id}
        AND "mode" = 'live'
        AND jsonb_typeof("route" -> 'switched') = 'array'
    ) AS j
    WHERE "provider" IS NOT NULL
    ORDER BY "provider", "key", "status", "at" DESC`;
}

// The last call that worked and the last error of one provider, among the
// outcomes on the keys `counts` accepts. The error shows until a later call
// works.
function healthOf(
  outcomes: Outcome[],
  provider: ProviderId,
  counts: (key: string) => boolean,
): Pick<ProviderHealth, "lastError" | "keyRejected" | "lastOkAt"> {
  let lastOk: Date | undefined;
  let lastFailed: { at: Date; message: string } | undefined;
  for (const row of outcomes) {
    if (row.provider !== provider || row.key === null || !counts(row.key)) {
      continue;
    }
    if (row.status === "done") {
      if (!lastOk || row.at > lastOk) lastOk = row.at;
    } else if (!lastFailed || row.at > lastFailed.at) {
      lastFailed = { at: row.at, message: row.error ?? "" };
    }
  }
  const current =
    lastFailed && (!lastOk || lastFailed.at > lastOk) ? lastFailed : null;
  return {
    lastError: current
      ? {
          at: current.at.toISOString(),
          message: readableFailure(current.message, provider),
        }
      : null,
    keyRejected: current !== null && isKeyRejectedText(current.message),
    lastOkAt: lastOk?.toISOString() ?? null,
  };
}

// The health of the key the reader's calls run on (the scope's, read inside
// the reader's keys). A reader on the team key, or with no key at all, reads
// the team key's, which includes the calls from before keys were recorded.
// Models a provider no longer lists stay per provider.
export async function providerHealth(
  maker: MakerRef,
): Promise<ProviderHealth[]> {
  const read = hasDatabase();
  const [unlisted, outcomes, reach] = await Promise.all([
    read ? readUnlisted(maker.id) : ({} as UnlistedModels),
    read ? lastOutcomes(maker) : [],
    providerReach(maker),
  ]);
  return PROVIDERS.map((provider) => {
    const id = providerKeyId(provider);
    const team = id === undefined || reach[provider].whose === "team";
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      keyPresent: hasProviderKey(provider),
      ...healthOf(
        outcomes,
        provider,
        (key) => key === id || (team && key === ""),
      ),
      unlisted: unlisted[provider] ?? null,
    };
  });
}

export interface KeyHealth
  extends Pick<ProviderHealth, "lastError" | "keyRejected" | "lastOkAt"> {
  keyId: string;
  provider: ProviderId;
}

// Each key's own last calls, for the owner's list: the team key's include
// the calls from before keys were recorded.
export async function keyHealth(maker: MakerRef): Promise<KeyHealth[]> {
  if (!hasDatabase()) return [];
  const keys = await db.providerKey.findMany({
    where: { makerId: maker.id },
    select: { id: true, provider: true, forTeam: true },
  });
  const outcomes = await lastOutcomes(maker);
  return keys.flatMap((key) => {
    const provider = key.provider as ProviderId;
    if (!PROVIDERS.includes(provider)) return [];
    return [
      {
        keyId: key.id,
        provider,
        ...healthOf(
          outcomes,
          provider,
          (k) => k === key.id || (key.forTeam && k === ""),
        ),
      },
    ];
  });
}

// Check a provider's key now, for free, and keep the answer as the latest
// call of the key in use (the scope's): a replaced key clears the error it
// left, and a key the provider rejects says so before any paid call. The models it lists are
// compared with the catalog: an offered model it no longer names is kept with
// the answer, so Settings names it and the queue refuses it before paying.
export async function checkKey(
  maker: MakerRef,
  provider: ProviderId,
): Promise<KeyCheck & { unlisted?: string[] }> {
  const result = await checkProviderKey(provider);
  const unlisted = result.ok ? unlistedModels(provider, result.models) : [];
  if (result.called && hasDatabase()) {
    await recordKeyCheck({
      makerId: maker.id,
      provider,
      error: result.ok ? null : result.message,
      ...(result.ok ? { unlisted } : {}),
      memberId: maker.member?.id ?? null,
      providerKeyId: providerKeyId(provider),
    });
  }
  return result.ok ? { ...result, unlisted } : result;
}

// Check one key of the studio's, for free, whoever it is given to, and keep
// the answer on that key. A key of another studio is refused before any
// request.
export async function checkKeyById(
  maker: MakerRef,
  keyId: string,
): Promise<KeyCheck & { unlisted?: string[]; provider: ProviderId }> {
  return withKey(maker, keyId, async (provider) => ({
    ...(await checkKey(maker, provider)),
    provider,
  }));
}
