-- The laser cost calculator becomes an optional module (M4): its saved
-- defaults move from the generic Maker row to the module's own settings row
-- (module "laser-pricing"), then Maker.pricing goes. Moves data: rehearsed on a
-- copy of the dev database first.
-- CreateTable
CREATE TABLE "ModuleSettings" (
    "makerId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleSettings_pkey" PRIMARY KEY ("makerId","module")
);

-- AddForeignKey
ALTER TABLE "ModuleSettings" ADD CONSTRAINT "ModuleSettings_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move the saved calculator defaults.
INSERT INTO "ModuleSettings" ("makerId", "module", "settings", "updatedAt")
SELECT "id", 'laser-pricing', "pricing", CURRENT_TIMESTAMP
FROM "Maker"
WHERE "pricing" IS NOT NULL;

-- AlterTable
ALTER TABLE "Maker" DROP COLUMN "pricing";
