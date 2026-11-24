import {
  PROVIDER_LABELS,
  type ProviderId,
  unlistedModels,
} from "@/domain/model-defaults";
import { isKeyRejectedText, readableFailure } from "@/domain/queue";
import { db, hasDatabase } from "@/lib/db";
import { checkProviderKey, type KeyCheck } from "@/providers/key-check";
import { hasProviderKey } from "@/providers/keys";
import { readUnlisted, recordKeyCheck } from "@/server/generation-repository";
import { CAP_REACHED, NOT_RUN, NOT_STARTED } from "@/server/generation-worker";
import type { MakerRef } from "@/server/maker-repository";

// Each provider's health, free to read (no ping, no paid call): whether its
// key is set, and what its last live calls did — the queue's jobs and the
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

export async function providerHealth(
  makerId: string | null,
): Promise<ProviderHealth[]> {
  const ok = new Map<string, Date>();
  const failed = new Map<string, { at: Date; message: string }>();
  const unlisted = makerId && hasDatabase() ? await readUnlisted(makerId) : {};
  if (makerId && hasDatabase()) {
    const rows = await db.$queryRaw<
      {
        provider: string | null;
        status: string;
        at: Date;
        error: string | null;
      }[]
    >`
      SELECT DISTINCT ON ("provider", "status") "provider", "status", "at", "error"
      FROM (
        SELECT COALESCE("request" #>> '{model,provider}', "request" ->> 'provider')
                 AS "provider",
               "status", "finishedAt" AS "at", "error"
        FROM "GenerationJob"
        WHERE "makerId" = ${makerId}
          AND "mode" = 'live'
          AND "finishedAt" IS NOT NULL
          AND ("status" = 'done'
               OR ("status" = 'failed' AND "error" IS NOT NULL
                   AND "error" NOT IN (${CAP_REACHED}, ${NOT_STARTED})
                   AND "error" NOT LIKE ${`${NOT_RUN}%`}))
        UNION ALL
        SELECT s #>> '{from,provider}', 'failed', (s ->> 'at')::timestamptz,
               s ->> 'reason'
        FROM "GenerationJob", jsonb_array_elements("route" -> 'switched') AS s
        WHERE "makerId" = ${makerId}
          AND "mode" = 'live'
          AND jsonb_typeof("route" -> 'switched') = 'array'
      ) AS j
      WHERE "provider" IS NOT NULL
      ORDER BY "provider", "status", "at" DESC`;
    for (const row of rows) {
      if (!row.provider) continue;
      if (row.status === "done") ok.set(row.provider, row.at);
      else failed.set(row.provider, { at: row.at, message: row.error ?? "" });
    }
  }
  return PROVIDERS.map((provider) => {
    const lastOk = ok.get(provider);
    const lastFailed = failed.get(provider);
    const current =
      lastFailed && (!lastOk || lastFailed.at > lastOk) ? lastFailed : null;
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      keyPresent: hasProviderKey(provider),
      lastError: current
        ? {
            at: current.at.toISOString(),
            message: readableFailure(current.message, provider),
          }
        : null,
      keyRejected: current !== null && isKeyRejectedText(current.message),
      lastOkAt: lastOk?.toISOString() ?? null,
      unlisted: unlisted[provider] ?? null,
    };
  });
}

// Check a provider's key now, for free, and keep the answer as the provider's
// latest call: a key replaced in .env clears the error it left, and a key the
// provider rejects says so before any paid call. The models it lists are
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
    });
  }
  return result.ok ? { ...result, unlisted } : result;
}
