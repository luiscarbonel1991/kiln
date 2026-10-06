-- The maker's default model per kind (image, video, text) from Settings →
-- Models; null reads as Kiln's defaults. Additive.
-- AlterTable
ALTER TABLE "Maker" ADD COLUMN     "models" JSONB;
