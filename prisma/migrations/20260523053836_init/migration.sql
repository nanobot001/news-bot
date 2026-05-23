-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "rawJson" TEXT
);

-- CreateIndex
CREATE INDEX "Article_topic_idx" ON "Article"("topic");

-- CreateIndex
CREATE INDEX "Article_urlHash_idx" ON "Article"("urlHash");

-- CreateIndex
CREATE INDEX "Article_titleHash_idx" ON "Article"("titleHash");

-- CreateIndex
CREATE INDEX "Article_postedAt_idx" ON "Article"("postedAt");
