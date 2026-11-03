-- CreateTable
CREATE TABLE "ShopWrite" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "listingId" TEXT,
    "action" TEXT NOT NULL,
    "requestKey" TEXT,
    "projectId" TEXT,
    "destinationId" TEXT,
    "productId" TEXT,
    "sent" JSONB NOT NULL,
    "by" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopWrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopWrite_makerId_listingId_idx" ON "ShopWrite"("makerId", "listingId");

-- CreateIndex
CREATE INDEX "ShopWrite_makerId_projectId_idx" ON "ShopWrite"("makerId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopWrite_makerId_requestKey_key" ON "ShopWrite"("makerId", "requestKey");

-- AddForeignKey
ALTER TABLE "ShopWrite" ADD CONSTRAINT "ShopWrite_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
