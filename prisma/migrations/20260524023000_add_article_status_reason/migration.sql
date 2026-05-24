-- Add lightweight audit fields for article posting/search status.
ALTER TABLE "Article" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'INDEXED';
ALTER TABLE "Article" ADD COLUMN "statusReason" TEXT;

CREATE INDEX "Article_status_idx" ON "Article"("status");
