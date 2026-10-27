-- A shop connected through its platform's OAuth (ROADMAP Phase 20, the Etsy
-- connection; Luis, 2026-10-27). Additive: a new table, nothing existing changes.

-- CreateTable
CREATE TABLE "ShopConnection" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "shopUrl" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ShopConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopConnection_makerId_platform_key" ON "ShopConnection"("makerId", "platform");

-- AddForeignKey
ALTER TABLE "ShopConnection" ADD CONSTRAINT "ShopConnection_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
