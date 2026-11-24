-- Several keys per provider: a key has its own id, a name, and whether it is
-- the team's; ProviderKeyAccess names the people a key is given to; each
-- call records the key it ran on. Every key saved so far becomes its
-- studio's team key, so a studio with one key per provider runs as before.
-- Written by hand from `prisma migrate diff`: the diff adds "id" and "name"
-- as NOT NULL, which fails on a table with rows.

-- 1. New columns; id and name stay nullable until every row has them.
ALTER TABLE "ProviderKey"
ADD COLUMN     "id" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "forTeam" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Every key saved so far is its studio's team key. "sealed", "hint" and
--    "provider" are not touched, so each still unseals under its purpose.
UPDATE "ProviderKey"
SET "id" = gen_random_uuid()::text,
    "name" = 'Team key',
    "forTeam" = true,
    "createdAt" = "updatedAt";

-- 3. The key's own id replaces ("makerId", "provider") as the primary key.
--    That old key made ("makerId", "provider") unique, so no index below can
--    fail on the rows just written.
ALTER TABLE "ProviderKey"
ALTER COLUMN "id" SET NOT NULL,
ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "ProviderKey" DROP CONSTRAINT "ProviderKey_pkey",
ADD CONSTRAINT "ProviderKey_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderKey_makerId_id_provider_key" ON "ProviderKey"("makerId", "id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderKey_makerId_provider_name_key" ON "ProviderKey"("makerId", "provider", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderKey_one_team_key" ON "ProviderKey"("makerId", "provider") WHERE ("forTeam");

-- 4. Who a key is given to. Its maker and provider are its key's.
-- CreateTable
CREATE TABLE "ProviderKeyAccess" (
    "makerId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderKeyAccess_pkey" PRIMARY KEY ("keyId","memberId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderKeyAccess_makerId_memberId_provider_key" ON "ProviderKeyAccess"("makerId", "memberId", "provider");

-- AddForeignKey
ALTER TABLE "ProviderKeyAccess" ADD CONSTRAINT "ProviderKeyAccess_makerId_keyId_provider_fkey" FOREIGN KEY ("makerId", "keyId", "provider") REFERENCES "ProviderKey"("makerId", "id", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderKeyAccess" ADD CONSTRAINT "ProviderKeyAccess_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. The key a call ran on; no foreign key, the ledger outlives a key.
-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "providerKeyId" TEXT;
