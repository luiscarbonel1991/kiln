-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "family" TEXT,
    "topic" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "move" JSONB,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TasteSignal" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "slotLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "knob" TEXT NOT NULL,
    "stop" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TasteSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lesson_makerId_status_idx" ON "Lesson"("makerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_makerId_key_key" ON "Lesson"("makerId", "key");

-- CreateIndex
CREATE INDEX "TasteSignal_makerId_family_destinationId_slotKey_knob_creat_idx" ON "TasteSignal"("makerId", "family", "destinationId", "slotKey", "knob", "createdAt");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TasteSignal" ADD CONSTRAINT "TasteSignal_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Maker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
