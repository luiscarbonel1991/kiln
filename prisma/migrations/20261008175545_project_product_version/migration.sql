-- Product versions: the product a project was built from (or last updated to)
-- and its hash, and the version each job was built from. Additive, nullable:
-- projects and jobs from before read as "version unknown".
-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "productHash" TEXT;

-- AlterTable
ALTER TABLE "ProjectProduct" ADD COLUMN     "productHash" TEXT,
ADD COLUMN     "productSnapshot" JSONB;
