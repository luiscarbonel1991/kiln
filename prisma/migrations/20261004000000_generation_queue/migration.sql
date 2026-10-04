-- The background generation queue (M3): approved batches, their jobs (the
-- exact paid request, lease, cost) and the maker's monthly cap ($25 default,
-- Luis 2026-10-02). Additive, plus one data fix: cards left in "rendering"
-- by the editor's old autosave have no job behind them and would never be
-- picked again, so they go back to draft.
-- AlterTable
ALTER TABLE "Maker" ADD COLUMN     "monthlyCapCents" INTEGER NOT NULL DEFAULT 2500;

-- CreateTable
CREATE TABLE "GenerationBatch" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "projectId" TEXT,
    "mode" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "estimateMicros" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMPTZ(3),

    CONSTRAINT "GenerationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "makerId" TEXT NOT NULL,
    "projectId" TEXT,
    "cardId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseToken" TEXT,
    "request" JSONB,
    "estimateMicros" INTEGER NOT NULL,
    "actualMicros" INTEGER,
    "usage" JSONB,
    "outputUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationBatch_projectId_idx" ON "GenerationBatch"("projectId");

-- CreateIndex
CREATE INDEX "GenerationJob_status_mode_availableAt_idx" ON "GenerationJob"("status", "mode", "availableAt");

-- CreateIndex
CREATE INDEX "GenerationJob_projectId_cardId_idx" ON "GenerationJob"("projectId", "cardId");

-- CreateIndex
CREATE INDEX "GenerationJob_makerId_createdAt_idx" ON "GenerationJob"("makerId", "createdAt");

-- AddForeignKey
ALTER TABLE "GenerationBatch" ADD CONSTRAINT "GenerationBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "GenerationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: orphaned "rendering" cards.
UPDATE "Card" SET "status" = 'draft' WHERE "status" = 'rendering';
