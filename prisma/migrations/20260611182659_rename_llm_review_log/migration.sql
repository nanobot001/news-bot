/*
  Warnings:

  - You are about to drop the `LLMReviewLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "LLMReviewLog";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "LlmReviewLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LlmReviewLog_topic_idx" ON "LlmReviewLog"("topic");

-- CreateIndex
CREATE INDEX "LlmReviewLog_actionType_idx" ON "LlmReviewLog"("actionType");

-- CreateIndex
CREATE INDEX "LlmReviewLog_createdAt_idx" ON "LlmReviewLog"("createdAt");
