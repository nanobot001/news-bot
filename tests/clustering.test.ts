import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

// Force test database URL
const TEST_DB_URL = "file:./dev-test-clustering.db";
const TEST_DB_FILE = "./prisma/dev-test-clustering.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import {
  saveArticle,
  getActiveAnchors,
  setStoryThreadId,
  updateLastStoryAddedAt,
  getInactiveStoryAnchors,
  closeStoryAnchor
} from "../src/storage/articleRepo.js";
import { ARTICLE_STATUSES } from "../src/storage/articleStatus.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

before(async () => {
  cleanUpTestFiles();
  createEmptyTestDbFile();
  try {
    const output = execSync("npx prisma db push --skip-generate --accept-data-loss", {
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      stdio: "pipe",
    });
  } catch (error: any) {
    throw error;
  }
});

after(async () => {
  await prisma.$disconnect();
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-clustering.db",
    "./prisma/dev-test-clustering.db-journal",
    "./dev-test-clustering.db",
    "./dev-test-clustering.db-journal",
  ];
  for (const file of filesToDelete) {
    try {
      if (existsSync(file)) {
        rmSync(file, { force: true });
      }
    } catch (err) {}
  }
}

function createEmptyTestDbFile() {
  closeSync(openSync(TEST_DB_FILE, "w"));
}

test("Similarity Clustering Database Operations", async (t) => {
  await t.test("should manage story thread clustering metadata", async () => {
    const event: NormalizedEvent = {
      id: "parent-1",
      type: "news.article",
      topic: "toronto-eats",
      title: "Michelin Guide 2026: New Stars Announced for Toronto",
      url: "https://example.com/eats/michelin",
      sourceName: "Toronto Eats News",
    };

    // Save parent article
    const parent = await saveArticle(event, 50, new Date(), ARTICLE_STATUSES.POSTED);
    assert.equal(parent.id, "parent-1");

    // Fetch active anchors - should return the parent article
    let activeAnchors = await getActiveAnchors("toronto-eats");
    assert.equal(activeAnchors.length, 1);
    assert.equal(activeAnchors[0].id, "parent-1");

    // Set storyThreadId
    await setStoryThreadId("parent-1", "toronto-eats", "thread-12345");
    
    // Retrieve parent to verify
    let updatedParent = await prisma.article.findUnique({
      where: { id_topic: { id: "parent-1", topic: "toronto-eats" } }
    });
    assert.equal(updatedParent?.storyThreadId, "thread-12345");

    // Update lastStoryAddedAt
    const now = new Date();
    await updateLastStoryAddedAt("parent-1", "toronto-eats", now);
    updatedParent = await prisma.article.findUnique({
      where: { id_topic: { id: "parent-1", topic: "toronto-eats" } }
    });
    assert.ok(updatedParent?.lastStoryAddedAt);

    // Save a child article linked to this anchor
    const childEvent: NormalizedEvent = {
      id: "child-1",
      type: "news.article",
      topic: "toronto-eats",
      title: "Another Michelin Star for Toronto!",
      url: "https://example.com/eats/michelin-more",
      sourceName: "Toronto Eats News",
    };

    await saveArticle(
      childEvent,
      40,
      new Date(),
      ARTICLE_STATUSES.RELATED_COVERAGE,
      "Clustered automatically",
      "msg-child",
      "thread-12345",
      "parent-1",
      "toronto-eats"
    );

    const child = await prisma.article.findUnique({
      where: { id_topic: { id: "child-1", topic: "toronto-eats" } }
    });
    assert.equal(child?.anchorId, "parent-1");
    assert.equal(child?.anchorTopic, "toronto-eats");
    assert.equal(child?.discordChannelId, "thread-12345");
    assert.equal(child?.status, ARTICLE_STATUSES.RELATED_COVERAGE);
  });

  await t.test("should retrieve and close inactive story threads", async () => {
    // Clear db for isolation
    await prisma.article.deleteMany({});

    const event: NormalizedEvent = {
      id: "parent-inactive",
      type: "news.article",
      topic: "sports",
      title: "Leafs Playoff Game 1",
      url: "https://example.com/sports/leafs",
      sourceName: "Sports Central",
    };

    // Save parent thread anchor
    const parent = await saveArticle(event, 50, new Date(), ARTICLE_STATUSES.POSTED);
    await setStoryThreadId("parent-inactive", "sports", "thread-inactive");

    // Manually backdate postedAt and lastStoryAddedAt to 25 hours ago
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.article.update({
      where: { id_topic: { id: "parent-inactive", topic: "sports" } },
      data: {
        postedAt: twentyFiveHoursAgo,
        lastStoryAddedAt: twentyFiveHoursAgo,
      }
    });

    // Run getInactiveStoryAnchors
    let inactive = await getInactiveStoryAnchors();
    assert.equal(inactive.length, 1);
    assert.equal(inactive[0].id, "parent-inactive");

    // Close the story anchor
    await closeStoryAnchor("parent-inactive", "sports");

    // Retrieve again - should no longer be in inactive list because it is CLOSED
    inactive = await getInactiveStoryAnchors();
    assert.equal(inactive.length, 0);

    const closed = await prisma.article.findUnique({
      where: { id_topic: { id: "parent-inactive", topic: "sports" } }
    });
    assert.equal(closed?.statusReason, "CLOSED");
  });
});
