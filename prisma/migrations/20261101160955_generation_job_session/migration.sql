-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "GenerationJob_sessionId_idx" ON "GenerationJob"("sessionId");
