/*
  Warnings:

  - The primary key for the `Article` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateTable
CREATE TABLE "UserFavorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleTopic" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "discordMessageId" TEXT NOT NULL,
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instapaperStatus" TEXT NOT NULL,
    CONSTRAINT "UserFavorite_articleId_articleTopic_fkey" FOREIGN KEY ("articleId", "articleTopic") REFERENCES "Article" ("id", "topic") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailForward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleTopic" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "discordMessageId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailForward_articleId_articleTopic_fkey" FOREIGN KEY ("articleId", "articleTopic") REFERENCES "Article" ("id", "topic") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CurationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "source" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "mergedIntoId" TEXT,
    "discordThreadId" TEXT,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Story_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Story_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Story" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StorySignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT,
    "articleId" TEXT,
    "articleTopic" TEXT,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    CONSTRAINT "StorySignal_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StorySignal_articleId_articleTopic_fkey" FOREIGN KEY ("articleId", "articleTopic") REFERENCES "Article" ("id", "topic") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LLMReviewLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "urlHash" TEXT,
    "title" TEXT NOT NULL,
    "titleHash" TEXT,
    "topic" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" DATETIME,
    "score" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'INDEXED',
    "statusReason" TEXT,
    "intent" TEXT,
    "intentConfidence" REAL,
    "route" TEXT,
    "routeReason" TEXT,
    "rawJson" TEXT,
    "discordMessageId" TEXT,
    "discordChannelId" TEXT,
    "storyId" TEXT,

    PRIMARY KEY ("id", "topic"),
    CONSTRAINT "Article_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("firstSeenAt", "id", "intent", "intentConfidence", "postedAt", "publishedAt", "rawJson", "route", "routeReason", "score", "source", "status", "statusReason", "title", "titleHash", "topic", "url", "urlHash") SELECT "firstSeenAt", "id", "intent", "intentConfidence", "postedAt", "publishedAt", "rawJson", "route", "routeReason", "score", "source", "status", "statusReason", "title", "titleHash", "topic", "url", "urlHash" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE INDEX "Article_topic_idx" ON "Article"("topic");
CREATE INDEX "Article_urlHash_idx" ON "Article"("urlHash");
CREATE INDEX "Article_titleHash_idx" ON "Article"("titleHash");
CREATE INDEX "Article_postedAt_idx" ON "Article"("postedAt");
CREATE INDEX "Article_status_idx" ON "Article"("status");
CREATE INDEX "Article_intent_idx" ON "Article"("intent");
CREATE INDEX "Article_route_idx" ON "Article"("route");
CREATE INDEX "Article_discordMessageId_idx" ON "Article"("discordMessageId");
CREATE INDEX "Article_storyId_idx" ON "Article"("storyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UserFavorite_userId_idx" ON "UserFavorite"("userId");

-- CreateIndex
CREATE INDEX "UserFavorite_savedAt_idx" ON "UserFavorite"("savedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavorite_userId_articleId_articleTopic_key" ON "UserFavorite"("userId", "articleId", "articleTopic");

-- CreateIndex
CREATE INDEX "EmailForward_userId_idx" ON "EmailForward"("userId");

-- CreateIndex
CREATE INDEX "EmailForward_createdAt_idx" ON "EmailForward"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailForward_userId_articleId_articleTopic_key" ON "EmailForward"("userId", "articleId", "articleTopic");

-- CreateIndex
CREATE INDEX "CurationLog_topic_idx" ON "CurationLog"("topic");

-- CreateIndex
CREATE INDEX "CurationLog_status_idx" ON "CurationLog"("status");

-- CreateIndex
CREATE INDEX "CurationLog_createdAt_idx" ON "CurationLog"("createdAt");

-- CreateIndex
CREATE INDEX "Event_topic_idx" ON "Event"("topic");

-- CreateIndex
CREATE INDEX "Story_topic_idx" ON "Story"("topic");

-- CreateIndex
CREATE INDEX "Story_status_idx" ON "Story"("status");

-- CreateIndex
CREATE INDEX "StorySignal_storyId_idx" ON "StorySignal"("storyId");

-- CreateIndex
CREATE INDEX "StorySignal_articleId_articleTopic_idx" ON "StorySignal"("articleId", "articleTopic");

-- CreateIndex
CREATE INDEX "StorySignal_type_value_idx" ON "StorySignal"("type", "value");

-- CreateIndex
CREATE INDEX "LLMReviewLog_topic_idx" ON "LLMReviewLog"("topic");

-- CreateIndex
CREATE INDEX "LLMReviewLog_actionType_idx" ON "LLMReviewLog"("actionType");

-- CreateIndex
CREATE INDEX "LLMReviewLog_createdAt_idx" ON "LLMReviewLog"("createdAt");
