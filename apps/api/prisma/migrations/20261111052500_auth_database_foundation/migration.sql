-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- AlterTable User: Add status, verification timestamps, avatar, and last login
ALTER TABLE "User" 
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateIndex on User(status)
CREATE INDEX "User_status_idx" ON "User"("status");

-- AlterTable UserSession: Rename tokenHash to refreshTokenHash, add userAgent and updatedAt
ALTER TABLE "UserSession" RENAME COLUMN "tokenHash" TO "refreshTokenHash";
ALTER TABLE "UserSession" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "UserSession" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rename unique index on UserSession.refreshTokenHash
ALTER INDEX "UserSession_tokenHash_key" RENAME TO "UserSession_refreshTokenHash_key";

-- CreateIndex on UserSession(expiresAt)
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex on UserSession(userId, revokedAt)
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");
