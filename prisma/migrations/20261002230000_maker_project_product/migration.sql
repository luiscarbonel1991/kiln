-- Workspace -> Project, MakerProfile -> Maker, new Product (ROADMAP "Domain
-- model", 2026-10-02). Hand-written from Prisma's generated DDL: Prisma would
-- DROP "Workspace" and the "workspaceId" columns; this renames them instead, so
-- every workspace and card survives as a project of the default maker. Names and
-- types match what Prisma expects (`migrate diff --exit-code` returns 0).

BEGIN;

-- Maker, seeded with the default maker. The laser-pricing defaults saved in the
-- MakerProfile singleton (if any) move to Maker.pricing.
CREATE TABLE "Maker" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricing" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Maker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Maker_slug_key" ON "Maker"("slug");

INSERT INTO "Maker" ("id", "slug", "name", "pricing", "updatedAt")
SELECT gen_random_uuid()::text, 'default', 'My studio',
       (SELECT "data" FROM "MakerProfile" WHERE "id" = 'default'),
       CURRENT_TIMESTAMP;

DROP TABLE "MakerProfile";

-- Workspace -> Project. "updatedAt" is left untouched (no trigger), so the
-- most-recent ordering survives.
ALTER TABLE "Workspace" RENAME TO "Project";
ALTER TABLE "Project" RENAME CONSTRAINT "Workspace_pkey" TO "Project_pkey";

ALTER TABLE "Project" ADD COLUMN "makerId" TEXT;
ALTER TABLE "Project" ADD COLUMN "type" TEXT;

UPDATE "Project" SET "makerId" = (SELECT "id" FROM "Maker" WHERE "slug" = 'default');

-- Mirrors studioProjectType() in src/server/project-mapper.ts.
UPDATE "Project" SET "type" = CASE
    WHEN "recipeId" = 'recipe-laser-lineart' THEN 'design'
    WHEN "recipeId" IN ('recipe-social-launch', 'recipe-ads') THEN 'content'
    ELSE 'listing-kit'
END;

ALTER TABLE "Project" ALTER COLUMN "makerId" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "type" SET NOT NULL;

CREATE INDEX "Project_makerId_idx" ON "Project"("makerId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MasterAsset and Card are keyed by projectId. Their foreign keys already point
-- at the renamed table; only the names change. The primary keys keep their names.
ALTER TABLE "MasterAsset" RENAME COLUMN "workspaceId" TO "projectId";
ALTER TABLE "MasterAsset" RENAME CONSTRAINT "MasterAsset_workspaceId_fkey" TO "MasterAsset_projectId_fkey";

ALTER TABLE "Card" RENAME COLUMN "workspaceId" TO "projectId";
ALTER TABLE "Card" RENAME CONSTRAINT "Card_workspaceId_fkey" TO "Card_projectId_fkey";
ALTER INDEX "Card_workspaceId_idx" RENAME TO "Card_projectId_idx";

-- Product + the products a project uses.
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "source" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectProduct" (
    "projectId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectProduct_pkey" PRIMARY KEY ("projectId","productId")
);

CREATE UNIQUE INDEX "Product_makerId_sku_key" ON "Product"("makerId", "sku");

CREATE INDEX "ProjectProduct_productId_idx" ON "ProjectProduct"("productId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectProduct" ADD CONSTRAINT "ProjectProduct_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectProduct" ADD CONSTRAINT "ProjectProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
