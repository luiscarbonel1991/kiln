-- AlterTable
ALTER TABLE "GenerationBatch" ADD COLUMN     "finishedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ToolCall" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_makerId_updatedAt_idx" ON "ChatSession"("makerId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_projectId_updatedAt_idx" ON "ChatSession"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_seq_idx" ON "ChatMessage"("sessionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_messageId_key" ON "ChatMessage"("sessionId", "messageId");

-- CreateIndex
CREATE INDEX "ToolCall_sessionId_at_idx" ON "ToolCall"("sessionId", "at");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
