import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

// Force test database URL
const TEST_DB_URL = "file:./dev-test-clustering.db";
const TEST_DB_FILE = "./prisma/dev-test-clustering.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { extractSignals } from "../src/processing/signals.js";
import { calculateSignalSimilarity, findBestStoryMatch } from "../src/processing/similarity.js";
import { createStory, getActiveStories, setStoryThreadId, updateLastActivityAt, getInactiveStories, closeStory } from "../src/storage/storyRepo.js";
import { archiveInactiveThreads } from "../src/jobs/pollNews.js";
import type { AppConfig } from "../src/config/loadConfig.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";
import { createCoverageIndexThread } from "../src/bot/threadUtils.js";

before(async () => {
  cleanUpTestFiles();
  createEmptyTestDbFile();
  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
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

test("Signal Extraction and Clustering Suite", async (t) => {
  await t.test("extractSignals - should extract entity and cue signals from title", () => {
    const event: NormalizedEvent = {
      id: "evt-1",
      type: "news.article",
      topic: "sports",
      title: "Knicks trade Julius Randle after injury comeback",
      url: "https://example.com/sports/randle",
      sourceName: "Sports News"
    };

    const signals = extractSignals(event);
    
    // Check entities
    const entities = signals.filter(s => s.type === "ENTITY").map(s => s.value);
    assert.ok(entities.includes("Knicks"));
    assert.ok(entities.includes("Julius Randle"));
    
    // Check cues
    const cues = signals.filter(s => s.type === "CUE").map(s => s.value);
    assert.ok(cues.includes("trade"));
    assert.ok(cues.includes("injury"));
    assert.ok(cues.includes("comeback"));
  });

  await t.test("calculateSignalSimilarity - should calculate Jaccard similarity between signals", () => {
    const sigsA = [
      { type: "ENTITY" as const, value: "Knicks", weight: 1 },
      { type: "ENTITY" as const, value: "Julius Randle", weight: 1 },
      { type: "CUE" as const, value: "trade", weight: 1 }
    ];

    const sigsB = [
      { type: "ENTITY" as const, value: "Knicks", weight: 1 },
      { type: "ENTITY" as const, value: "Julius Randle", weight: 1 },
      { type: "CUE" as const, value: "injury", weight: 1 }
    ];

    const similarity = calculateSignalSimilarity(sigsA, sigsB);
    // Intersection: Knicks, Julius Randle (2)
    // Union: Knicks, Julius Randle, trade, injury (4)
    // Jaccard similarity: 2/4 = 0.5
    assert.equal(similarity, 0.5);
  });

  await t.test("Database Story and Event Operations", async () => {
    const story = await createStory("toronto-eats", "Michelin Guide 2026 Toronto");
    assert.ok(story.id);
    assert.equal(story.title, "Michelin Guide 2026 Toronto");

    // Add signals to story
    await prisma.storySignal.create({
      data: {
        storyId: story.id,
        type: "ENTITY",
        value: "Michelin Guide"
      }
    });

    const activeStories = await getActiveStories("toronto-eats");
    assert.equal(activeStories.length, 1);
    assert.equal(activeStories[0].title, "Michelin Guide 2026 Toronto");
    assert.equal(activeStories[0].signals.length, 1);
    assert.equal(activeStories[0].signals[0].value, "Michelin Guide");

    // Set thread ID
    await setStoryThreadId(story.id, "thread-12345");
    const storyWithThread = await prisma.story.findUnique({ where: { id: story.id } });
    assert.equal(storyWithThread?.discordThreadId, "thread-12345");

    // Update last activity
    const now = new Date();
    await updateLastActivityAt(story.id, now);
    const storyWithActivity = await prisma.story.findUnique({ where: { id: story.id } });
    assert.equal(storyWithActivity?.lastActivityAt.getTime(), now.getTime());
  });

  await t.test("findBestStoryMatch - should find best match based on signals first, then title Jaccard", () => {
    const eventSignals = [
      { type: "ENTITY" as const, value: "Knicks", weight: 1 },
      { type: "ENTITY" as const, value: "Jalen Brunson", weight: 1 }
    ];

    const activeStories = [
      {
        id: "story-1",
        eventId: null,
        topic: "sports",
        title: "Knicks face Celtics in playoffs",
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "OPEN",
        mergedIntoId: null,
        discordThreadId: "thread-1",
        lastActivityAt: new Date(),
        signals: [
          { id: "s-1", storyId: "story-1", articleId: null, articleTopic: null, type: "ENTITY", value: "Knicks", weight: 1 },
          { id: "s-2", storyId: "story-1", articleId: null, articleTopic: null, type: "ENTITY", value: "Jalen Brunson", weight: 1 }
        ],
        articles: []
      }
    ];

    const match = findBestStoryMatch("Brunson leads Knicks", eventSignals, activeStories as any, 0.3, 0.25);
    assert.equal(match.story?.id, "story-1");
    assert.equal(match.reason, "signal");
  });

  await t.test("getInactiveStories and archiveInactiveThreads", async () => {
    // Clear db
    await prisma.story.deleteMany({});
    await prisma.article.deleteMany({});

    // Create a story and backdate its lastActivityAt
    const story = await prisma.story.create({
      data: {
        topic: "sports",
        title: "Leafs Playoff Game 1",
        discordThreadId: "thread-inactive",
        lastActivityAt: new Date(Date.now() - 13 * 60 * 60 * 1000) // 13 hours ago (limit is 12)
      }
    });

    const inactive = await getInactiveStories();
    assert.equal(inactive.length, 1);
    assert.equal(inactive[0].id, story.id);

    // Close the story
    await closeStory(story.id);

    const inactivePostClose = await getInactiveStories();
    assert.equal(inactivePostClose.length, 0);

    const closed = await prisma.story.findUnique({ where: { id: story.id } });
    assert.equal(closed?.status, "CLOSED");
  });

  await t.test("should archive stale active bot-owned threads", async () => {
    const staleThread = {
      id: "thread-orphan",
      name: "Orphaned stale story",
      parentId: "news-channel",
      ownerId: "bot-user",
      createdTimestamp: Date.now() - 13 * 60 * 60 * 1000,
      editPayload: null as any,
      async edit(payload: any) {
        this.editPayload = payload;
      },
    };

    const config: AppConfig = {
      topics: {
        news: {
          channelId: "news-channel",
          postThreshold: 10,
          keywords: [],
          blockedTerms: [],
        },
      },
      sources: {
        news: [],
      },
    };

    const mockClient = {
      user: { id: "bot-user" },
      guilds: {
        cache: new Map([
          [
            "guild-1",
            {
              channels: {
                fetchActiveThreads: async () => ({
                  threads: new Map([[staleThread.id, staleThread]]),
                }),
              },
            },
          ],
        ]),
      },
      channels: {
        fetch: async (channelId: string) => {
          assert.equal(channelId, "news-channel");
          return {
            threads: {
              fetchActive: async () => ({
                threads: new Map(),
              }),
            },
          };
        },
      },
    } as any;

    await archiveInactiveThreads(mockClient, config);

    assert.equal(staleThread.editPayload.archived, true);
    assert.equal(staleThread.editPayload.locked, true);
  });

  await t.test("createCoverageIndexThread uses the parent channel when anchor is already a thread", async () => {
    const sentPayloads: any[] = [];
    const parentChannel = {
      id: "news-channel",
      isTextBased: () => true,
      async send(payload: any) {
        sentPayloads.push(payload);
        return {
          id: "index-message",
          async pin() {},
          async startThread(options: any) {
            return {
              id: "new-thread",
              options,
              members: { add: async () => {} },
            };
          },
        };
      },
    };
    const existingThread = {
      id: "existing-thread",
      parent: parentChannel,
      isThread: () => true,
    };
    const mockClient = {
      channels: {
        fetch: async (id: string) => {
          assert.equal(id, "existing-thread");
          return existingThread;
        },
      },
    } as any;

    const result = await createCoverageIndexThread(mockClient, "existing-thread", "Blue Jays vs. Phillies Series (June 2026)");

    assert.equal(result.threadId, "new-thread");
    assert.equal(result.indexMessageId, "index-message");
    assert.equal(sentPayloads.length, 1);
    assert.match(sentPayloads[0].embeds[0].data.title, /Coverage Index/);
  });

  await t.test("createCoverageIndexThread deletes a placeholder when startThread fails", async () => {
    let deleted = false;
    let unpinned = false;
    const parentChannel = {
      id: "news-channel",
      isTextBased: () => true,
      async send() {
        return {
          id: "orphan-index-message",
          async pin() {},
          async unpin() {
            unpinned = true;
          },
          async delete() {
            deleted = true;
          },
          async startThread() {
            throw new Error("Cannot start thread");
          },
        };
      },
    };
    const mockClient = {
      channels: {
        fetch: async () => parentChannel,
      },
    } as any;

    await assert.rejects(
      () => createCoverageIndexThread(mockClient, "news-channel", "Blue Jays vs. Phillies Series (June 2026)"),
      /Cannot start thread/
    );

    assert.equal(unpinned, true);
    assert.equal(deleted, true);
  });
});
