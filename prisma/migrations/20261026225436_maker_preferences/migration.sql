-- The maker's remembered choices (ROADMAP 2026-10-26, P0-3): the hero's
-- setting per destination and product family. Additive: a new nullable
-- column, nothing existing changes.

-- AlterTable
ALTER TABLE "Maker" ADD COLUMN     "preferences" JSONB;
