-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "recipeId" TEXT,
    "understanding" JSONB,
    "planning" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterAsset" (
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "sourcePrompt" TEXT,
    "assetUrl" TEXT NOT NULL,
    "mime" TEXT NOT NULL,

    CONSTRAINT "MasterAsset_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "MakerProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "workspaceId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "parentCardId" TEXT,
    "masterAssetId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "references" JSONB NOT NULL,
    "model" JSONB NOT NULL,
    "video" JSONB,
    "promptOverride" TEXT,
    "vectorUrl" TEXT,
    "outputs" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("workspaceId","cardId")
);

-- CreateIndex
CREATE INDEX "Card_workspaceId_idx" ON "Card"("workspaceId");

-- AddForeignKey
ALTER TABLE "MasterAsset" ADD CONSTRAINT "MasterAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
