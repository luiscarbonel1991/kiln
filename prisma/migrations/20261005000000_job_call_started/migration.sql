-- Never pay twice for a job (review of M1-M3, A1): "callStartedAt" marks that
-- the paid call went out, stamped under the lease right before it. A job with
-- it set is never requeued, and once finished without a measured cost it
-- counts at its estimate. Existing finished-and-done jobs were all paid calls,
-- so they get their start time: the month's spend is unchanged.
-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "callStartedAt" TIMESTAMPTZ(3);

UPDATE "GenerationJob" SET "callStartedAt" = COALESCE("startedAt", "createdAt")
WHERE "status" = 'done';
