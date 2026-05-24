import { execSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

// 1. Force the test database URL before importing prisma or repository modules
const TEST_DB_URL = "file:./dev-test.db";
const TEST_DB_FILE = "./prisma/dev-test.db"; // SQLite relative to prisma directory/project root
process.env.DATABASE_URL = TEST_DB_URL;

// Import after setting env
import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle, getArticleById } from "../src/storage/articleRepo.js";
import { checkDuplicate } from "../src/processing/dedupe.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

// Force color-free output for accessibility
process.env.NO_COLOR = "1";
process.env.FORCE_COLOR = "0";

before(async () => {
  console.log("Setting up isolated test database...");
  // Clear any existing test db
  cleanUpTestFiles();

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
});
