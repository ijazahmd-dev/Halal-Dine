-- AlterTable
ALTER TABLE "UserSession" ADD COLUMN     "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "RotatedRefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RotatedRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RotatedRefreshToken_tokenHash_key" ON "RotatedRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RotatedRefreshToken_sessionId_idx" ON "RotatedRefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "RotatedRefreshToken_expiresAt_idx" ON "RotatedRefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "RotatedRefreshToken" ADD CONSTRAINT "RotatedRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
