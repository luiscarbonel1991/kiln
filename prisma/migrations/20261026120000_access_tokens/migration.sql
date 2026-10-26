-- Personal access tokens for the HTTP API (ROADMAP 2026-10-26, P0-1).
-- Additive: a new table, nothing existing changes.

-- CreateTable
CREATE TABLE "AccessToken" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessToken_hash_key" ON "AccessToken"("hash");

-- CreateIndex
CREATE INDEX "AccessToken_makerId_idx" ON "AccessToken"("makerId");

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

