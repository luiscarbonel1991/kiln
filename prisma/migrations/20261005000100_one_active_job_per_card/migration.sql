-- One active job per card (review of M1-M3, A3): enqueueBatch already skips
-- cards with a queued or running job under the maker lock; the index makes a
-- second paid job for the same card impossible whatever the caller sends.
-- Declared in schema.prisma through the "partialIndexes" preview feature.
-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_one_active_per_card" ON "GenerationJob"("projectId", "cardId") WHERE ("status" IN ('queued', 'running'));
