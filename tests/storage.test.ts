import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

// 1. Force the test database URL before importing prisma or repository modules
const TEST_DB_URL = "file:./dev-test.db";
const TEST_DB_FILE = "./prisma/dev-test.db"; // SQLite relative to prisma directory/project root
process.env.DATABASE_URL = TEST_DB_URL;

// Import after setting env
import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle, getArticleById, findDuplicateArticle, pruneOldArticles, getArticlesForTopic } from "../src/storage/articleRepo.js";
import { checkDuplicate } from "../src/processing/dedupe.js";
import { ARTICLE_STATUSES } from "../src/storage/articleStatus.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

// Force color-free output for accessibility
process.env.NO_COLOR = "1";
process.env.FORCE_COLOR = "0";

before(async () => {
  console.log("Setting up isolated test database...");
  // Clear any existing test db
  cleanUpTestFiles();
  createEmptyTestDbFile();

  try {
    // Capture output and write to stdout to avoid PowerShell coloring stderr red
    const output = execSync("npx prisma db push --skip-generate --accept-data-loss", {
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: "pipe",
    });
    process.stdout.write(output);
  } catch (error: any) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stdout.write(error.stderr);
    throw error;
  }
});

after(async () => {
  console.log("Cleaning up test database...");
  // Disconnect prisma
  await prisma.$disconnect();
  // Delete database files
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test.db",
    "./prisma/dev-test.db-journal",
    "./dev-test.db",
    "./dev-test.db-journal",
  ];
  for (const file of filesToDelete) {
    try {
      if (existsSync(file)) {
        rmSync(file, { force: true });
      }
    } catch (err) {
      // Ignore
    }
  }
}

function createEmptyTestDbFile() {
  closeSync(openSync(TEST_DB_FILE, "w"));
}

test("Storage and Deduplication System", async (t) => {
  await t.test("should save and retrieve an article correctly", async () => {
    const article: NormalizedEvent = {
      id: "guid-1",
      type: "news.article",
      topic: "space",
      title: "First Rocket Launches Successfully!",
      url: "https://example.com/space/rocket-1",
      sourceName: "Space News",
      publishedAt: "2026-05-23T00:00:00.000Z",
      summary: "A great launch was witnessed.",
      raw: { original: "data" },
    };

    const saved = await saveArticle(article, 25);
    assert.equal(saved.id, "guid-1");
    assert.equal(saved.title, "First Rocket Launches Successfully!");
    assert.equal(saved.score, 25);
    assert.equal(saved.topic, "space");
    assert.equal(saved.source, "Space News");

    const retrieved = await getArticleById("guid-1");
    assert.ok(retrieved);
    assert.equal(retrieved.title, "First Rocket Launches Successfully!");
    assert.equal(retrieved.rawJson, JSON.stringify({ original: "data" }));
  });

  await t.test("should flag exact duplicate by GUID (id)", async () => {
    const duplicateEvent: NormalizedEvent = {
      id: "guid-1", // Same GUID
      type: "news.article",
      topic: "space",
      title: "Different Title",
      url: "https://example.com/space/different-url",
      sourceName: "Space News",
    };

    const result = await checkDuplicate(duplicateEvent);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "guid");
  });

  await t.test("should flag duplicate by canonical URL hash", async () => {
    const duplicateEvent: NormalizedEvent = {
      id: "guid-2", // Different GUID
      type: "news.article",
      topic: "space",
      title: "Completely Different Title",
      url: "https://www.example.com/space/rocket-1/?utm_campaign=social", // Normalizes to example.com/space/rocket-1
      sourceName: "Space News Forum",
    };

    const result = await checkDuplicate(duplicateEvent);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "urlHash");
  });

  await t.test("should flag duplicate by normalized title hash fallback", async () => {
    const duplicateEvent: NormalizedEvent = {
      id: "guid-3", // Different GUID
      type: "news.article",
      topic: "space",
      title: "First Rocket Launches Successfully! 🚀", // Normalizes to "first rocket launches successfully"
      url: "https://example.com/different-space-article",
      sourceName: "Alternative Feed",
    };

    const result = await checkDuplicate(duplicateEvent);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.reason, "titleHash");
  });

  await t.test("should NOT flag duplicate if topic is different (topic isolation)", async () => {
    const spaceArticleInTechTopic: NormalizedEvent = {
      id: "guid-4", // Different GUID
      type: "news.article",
      topic: "technology", // Different Topic (space vs technology)
      title: "First Rocket Launches Successfully!", // Same title as space article
      url: "https://example.com/space/rocket-1", // Same URL as space article
      sourceName: "Tech News Daily",
    };

    const result = await checkDuplicate(spaceArticleInTechTopic);
    assert.equal(result.isDuplicate, false);
  });

  await t.test("should allow saving the same article GUID under two different topics (composite key isolation)", async () => {
    const article1: NormalizedEvent = {
      id: "same-guid-123",
      type: "news.article",
      topic: "topic-a",
      title: "Same Title",
      url: "https://example.com/same-url",
      sourceName: "Source A",
    };
    const article2: NormalizedEvent = {
      id: "same-guid-123",
      type: "news.article",
      topic: "topic-b",
      title: "Same Title",
      url: "https://example.com/same-url",
      sourceName: "Source B",
    };

    await saveArticle(article1, 10);
    await saveArticle(article2, 20);

    const retrieved1 = await getArticleById("same-guid-123", "topic-a");
    const retrieved2 = await getArticleById("same-guid-123", "topic-b");

    assert.ok(retrieved1);
    assert.ok(retrieved2);
    assert.equal(retrieved1.topic, "topic-a");
    assert.equal(retrieved1.score, 10);
    assert.equal(retrieved2.topic, "topic-b");
    assert.equal(retrieved2.score, 20);
  });

  await t.test("should deduplicate across sharing topics only if posted, but not if not posted", async () => {
    const originalEvent: NormalizedEvent = {
      id: "shared-guid-1",
      type: "news.article",
      topic: "topic-c",
      title: "Shared Article",
      url: "https://example.com/shared-1",
      sourceName: "Source C",
    };

    // Case A: Article saved but NOT posted (postedAt is null)
    await saveArticle(originalEvent, 10, undefined); // postedAt is null by default

    const checkEvent: NormalizedEvent = {
      id: "shared-guid-1",
      type: "news.article",
      topic: "topic-d",
      title: "Shared Article",
      url: "https://example.com/shared-1",
      sourceName: "Source D",
    };

    // checkDuplicate with sharingTopics including topic-c
    const resultNotPosted = await checkDuplicate(checkEvent, ["topic-c", "topic-d"]);
    // Since topic-c has not posted it, it shouldn't flag it as duplicate for topic-d
    assert.equal(resultNotPosted.isDuplicate, false);

    // Case B: Now mark topic-c as posted
    await saveArticle(originalEvent, 10, new Date()); // postedAt is set

    const resultPosted = await checkDuplicate(checkEvent, ["topic-c", "topic-d"]);
    // Now it should flag as duplicate because topic-c has posted it!
    assert.equal(resultPosted.isDuplicate, true);
    assert.equal(resultPosted.reason, "guid");
  });

  await t.test("should retrieve articles with status and timeframe filtering", async () => {
    const topic = "test-filtering";
    
    // Create an event that is posted
    const postedEvent: NormalizedEvent = {
      id: "filter-posted",
      type: "news.article",
      topic,
      title: "Posted Article",
      url: "https://example.com/posted",
      sourceName: "Source Filter",
      publishedAt: new Date().toISOString(),
    };
    await saveArticle(postedEvent, 10, new Date(), "POSTED");

    // Create an event that is unposted
    const unpostedEvent: NormalizedEvent = {
      id: "filter-unposted",
      type: "news.article",
      topic,
      title: "Unposted Article",
      url: "https://example.com/unposted",
      sourceName: "Source Filter",
      publishedAt: new Date().toISOString(),
    };
    await saveArticle(unpostedEvent, 5, null, "SKIPPED_LOW_SCORE");

    // Retrieve posted articles
    const posted = await getArticlesForTopic(topic, "posted");
    assert.equal(posted.length, 1);
    assert.equal(posted[0].id, "filter-posted");

    // Retrieve unposted articles
    const unposted = await getArticlesForTopic(topic, "unposted");
    assert.equal(unposted.length, 1);
    assert.equal(unposted[0].id, "filter-unposted");

    // Test timeframe filtering:
    // 1. Cutoff of 24 hours: both should match
    const within24 = await getArticlesForTopic(topic, "posted", 24);
    assert.equal(within24.length, 1);

    // 2. Mock an old unposted article (5 hours ago)
    const oldUnpostedEvent: NormalizedEvent = {
      id: "filter-old-unposted",
      type: "news.article",
      topic,
      title: "Old Unposted Article",
      url: "https://example.com/old-unposted",
      sourceName: "Source Filter",
      publishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    };
    await saveArticle(oldUnpostedEvent, 3, null, "SKIPPED_OLD");
    
    // Manually set firstSeenAt to 5 hours ago in DB
    await prisma.article.update({
      where: {
        id_topic: {
          id: "filter-old-unposted",
          topic,
        },
      },
      data: {
        firstSeenAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      },
    });

    // If we limit to 3 hours, the old one should be excluded
    const limit3Hours = await getArticlesForTopic(topic, "unposted", 3);
    assert.equal(limit3Hours.length, 1);
    assert.equal(limit3Hours[0].id, "filter-unposted");

    // If we limit to 6 hours, both unposted should be returned
    const limit6Hours = await getArticlesForTopic(topic, "unposted", 6);
    assert.equal(limit6Hours.length, 2);
  });

  await t.test("should save article intent and routing metadata", async () => {
    const event: NormalizedEvent = {
      id: "routing-metadata-1",
      type: "news.article",
      topic: "routing",
      title: "Routing Metadata Article",
      url: "https://example.com/routing",
      sourceName: "Routing Source",
    };

    const saved = await saveArticle(
      event,
      30,
      null,
      ARTICLE_STATUSES.DIGEST_PENDING,
      "Stored for digest",
      undefined,
      undefined,
      null,
      {
        intent: "discussion",
        intentConfidence: 0.82,
        route: "digest_pending",
        routeReason: "Discussion item did not match an active story thread",
      }
    );

    assert.equal(saved.intent, "discussion");
    assert.equal(saved.intentConfidence, 0.82);
    assert.equal(saved.route, "digest_pending");
    assert.equal(saved.routeReason, "Discussion item did not match an active story thread");
  });

  await t.test("should respect DEDUPE_WINDOW_DAYS setting for duplicate checking", async () => {
    const oldEvent: NormalizedEvent = {
      id: "old-guid-99",
      type: "news.article",
      topic: "sports",
      title: "Ancient News Story",
      url: "https://example.com/sports/ancient-1",
      sourceName: "Sports News",
    };

    // Save article (which sets firstSeenAt to now)
    const saved = await saveArticle(oldEvent, 15);

    // Force firstSeenAt to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.article.update({
      where: {
        id_topic: { id: saved.id, topic: saved.topic },
      },
      data: {
        firstSeenAt: tenDaysAgo,
      },
    });

    // 1. With dedupe window of 7 days, 10-day-old article should be ignored (not a duplicate)
    process.env.DEDUPE_WINDOW_DAYS = "7";
    const res7 = await findDuplicateArticle("sports", "old-guid-99", "https://example.com/sports/ancient-1", "Ancient News Story");
    assert.equal(res7, null);

    // 2. With dedupe window of 14 days, 10-day-old article should be detected as a duplicate
    process.env.DEDUPE_WINDOW_DAYS = "14";
    const res14 = await findDuplicateArticle("sports", "old-guid-99", "https://example.com/sports/ancient-1", "Ancient News Story");
    assert.ok(res14);
    assert.equal(res14.isDuplicate, true);
    assert.equal(res14.reason, "guid");

    // Clean up env
    delete process.env.DEDUPE_WINDOW_DAYS;
  });

  await t.test("should prune skipped old articles but save posted old articles", async () => {
    // Clear any previous records to ensure an isolated count
    await prisma.article.deleteMany({});

    const skippedEvent: NormalizedEvent = {
      id: "prune-skipped-1",
      type: "news.article",
      topic: "tech",
      title: "Uninteresting Tech Story",
      url: "https://example.com/tech/boring-1",
      sourceName: "Tech Feed",
    };

    const postedEvent: NormalizedEvent = {
      id: "prune-posted-1",
      type: "news.article",
      topic: "tech",
      title: "Awesome Tech Story",
      url: "https://example.com/tech/awesome-1",
      sourceName: "Tech Feed",
    };

    // Save skipped article
    const skipped = await saveArticle(skippedEvent, 5, null, ARTICLE_STATUSES.SKIPPED_LOW_SCORE);
    // Save posted article
    const posted = await saveArticle(postedEvent, 90, new Date(), ARTICLE_STATUSES.POSTED);

    // Backdate both to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.article.update({
      where: { id_topic: { id: skipped.id, topic: skipped.topic } },
      data: { firstSeenAt: tenDaysAgo },
    });
    await prisma.article.update({
      where: { id_topic: { id: posted.id, topic: posted.topic } },
      data: { firstSeenAt: tenDaysAgo },
    });

    // Run pruning for articles older than 7 days
    const prunedCount = await pruneOldArticles(7);
    assert.equal(prunedCount, 1); // Should prune only the skipped one

    // Verify database state
    const retrievedSkipped = await getArticleById("prune-skipped-1", "tech");
    assert.equal(retrievedSkipped, null); // Pruned!

    const retrievedPosted = await getArticleById("prune-posted-1", "tech");
    assert.ok(retrievedPosted); // Kept!
    assert.equal(retrievedPosted.id, "prune-posted-1");
  });
});
