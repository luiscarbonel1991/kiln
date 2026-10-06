import { PROVIDER_LABELS, type ProviderId } from "@/domain/model-defaults";
import { db, hasDatabase } from "@/lib/db";
import { hasProviderKey } from "@/providers/keys";
import { CAP_REACHED, NOT_STARTED } from "@/server/generation-worker";

// Each provider's health, free to read (no ping, no paid call): whether its
// key is set, and what its last live calls did — the queue's jobs and the
// direct calls (vision, art direction, the studio) all leave a row. The last
// error shows until a later call succeeds. Kiln's own refusals (the month's
// cap, a canceled job) are not the provider's and are skipped.

export interface ProviderHealth {
  provider: ProviderId;
  label: string;
  keyPresent: boolean;
  lastError: { at: string; message: string } | null;
  lastOkAt: string | null;
}

const PROVIDERS: ProviderId[] = ["openai", "google"];

export async function providerHealth(
  makerId: string | null,
): Promise<ProviderHealth[]> {
  const ok = new Map<string, Date>();
  const failed = new Map<string, { at: Date; message: string }>();
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
                   AND "error" NOT IN (${CAP_REACHED}, ${NOT_STARTED})))
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
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      keyPresent: hasProviderKey(provider),
      lastError:
        lastFailed && (!lastOk || lastFailed.at > lastOk)
          ? { at: lastFailed.at.toISOString(), message: lastFailed.message }
          : null,
      lastOkAt: lastOk?.toISOString() ?? null,
    };
  });
}
