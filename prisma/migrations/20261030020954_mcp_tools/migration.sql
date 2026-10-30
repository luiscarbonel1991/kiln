-- AlterTable
ALTER TABLE "AccessToken" ADD COLUMN     "canSpend" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SpendQuote" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "tokenId" TEXT,
    "action" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "typicalMicros" INTEGER NOT NULL,
    "maxMicros" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SpendQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "tokenId" TEXT,
    "tokenName" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "quoteId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "ms" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpendQuote_makerId_createdAt_idx" ON "SpendQuote"("makerId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_makerId_at_idx" ON "ToolCall"("makerId", "at");
