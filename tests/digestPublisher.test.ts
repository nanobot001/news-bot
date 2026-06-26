import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import cron from "node-cron";

// Force test database configuration for database-touching command tests
const TEST_DB_URL = "file:./dev-test-digest.db";
const TEST_DB_FILE = "./prisma/dev-test-digest.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle } from "../src/storage/articleRepo.js";
import { ARTICLE_STATUSES } from "../src/storage/articleStatus.js";
import { publishDigestForLane, startDigestSchedulers } from "../src/jobs/digestPublisher.js";
import type { AppConfig } from "../src/config/loadConfig.js";

before(async () => {
  console.log("Setting up isolated digest test database...");
  cleanUpTestFiles();
  createEmptyTestDbFile();

  try {
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
  console.log("Cleaning up digest test database...");
  const tasks = cron.getTasks();
  for (const t of tasks.values()) {
    t.stop();
  }
  await prisma.$disconnect();
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-digest.db",
    "./prisma/dev-test-digest.db-journal",
    "./dev-test-digest.db",
    "./dev-test-digest.db-journal",
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

test("Digest Publisher", async (t) => {
  const mockConfig: AppConfig = {
    topics: {
      "toronto-eats": {
        channelId: "1234567890",
        keywords: [],
        blockedTerms: [],
        postThreshold: 20,
        emoji: "🍔",
        intentRouting: {
          aggregate: {
            route: "digest_pending",
            digestSchedule: "0 21 * * *",
          },
        },
      },
      "disabled-topic": {
        channelId: "1234567890",
        keywords: [],
        blockedTerms: [],
        postThreshold: 20,
        disabled: true,
      },
    },
    sources: { "toronto-eats": [], "disabled-topic": [] },
  };

  await t.test("should skip publishing if topic is disabled", async () => {
    let discordCalled = false;
    const mockClient = {
      channels: {
        fetch: async () => {
          discordCalled = true;
          return null;
        },
      },
    } as any;

    await publishDigestForLane(mockClient, mockConfig, "disabled-topic", "aggregate");
    assert.equal(discordCalled, false);
  });

  await t.test("should gracefully do nothing if no pending digest articles exist", async () => {
    await prisma.article.deleteMany({});
    let discordCalled = false;
    const mockClient = {
      channels: {
        fetch: async () => {
          discordCalled = true;
          return null;
        },
      },
    } as any;

    await publishDigestForLane(mockClient, mockConfig, "toronto-eats", "aggregate");
    assert.equal(discordCalled, false);
  });

  await t.test("should correctly publish digest embed and update statuses to POSTED_DIGEST", async () => {
    await prisma.article.deleteMany({});
    
    // Create two pending digest articles
    await saveArticle(
      { id: "digest-1", type: "news.article", topic: "toronto-eats", title: "Review 1", sourceName: "Source A", url: "https://a.com" },
      30, null, ARTICLE_STATUSES.DIGEST_PENDING, null, undefined, undefined, null,
      { intent: "aggregate", intentConfidence: 0.9, route: "digest_pending", routeReason: "test" }
    );
    await saveArticle(
      { id: "digest-2", type: "news.article", topic: "toronto-eats", title: "Review 2", sourceName: "Source B", url: "https://b.com" },
      25, null, ARTICLE_STATUSES.DIGEST_PENDING, null, undefined, undefined, null,
      { intent: "aggregate", intentConfidence: 0.8, route: "digest_pending", routeReason: "test" }
    );
    
    // And one normal article to prove it is ignored
    await saveArticle(
      { id: "normal-1", type: "news.article", topic: "toronto-eats", title: "Normal News", sourceName: "Source C" },
      50, null, ARTICLE_STATUSES.INDEXED
    );

    let sentPayload: any = null;
    const mockChannel = {
      isTextBased: () => true,
      send: async (payload: any) => {
        sentPayload = payload;
        return { id: "discord-msg-123", channelId: "1234567890" };
      },
    };
    const mockClient = {
      channels: {
        fetch: async () => mockChannel,
      },
    } as any;

    await publishDigestForLane(mockClient, mockConfig, "toronto-eats", "aggregate");

    assert.ok(sentPayload, "Should have sent a discord message");
    const embedData = sentPayload.embeds[0].toJSON();
    
    // Verify embed format
    assert.equal(embedData.title, "🍔 Digest: toronto-eats - AGGREGATE");
    assert.match(embedData.description, /Review 1/);
    assert.match(embedData.description, /Review 2/);
    
    // Verify articles were updated to POSTED_DIGEST
    const art1 = await prisma.article.findUnique({ where: { id_topic: { id: "digest-1", topic: "toronto-eats" } } });
    const art2 = await prisma.article.findUnique({ where: { id_topic: { id: "digest-2", topic: "toronto-eats" } } });
    const normal = await prisma.article.findUnique({ where: { id_topic: { id: "normal-1", topic: "toronto-eats" } } });

    assert.equal(art1?.status, ARTICLE_STATUSES.POSTED_DIGEST);
    assert.equal(art1?.discordMessageId, "discord-msg-123");
    
    assert.equal(art2?.status, ARTICLE_STATUSES.POSTED_DIGEST);
    
    assert.equal(normal?.status, ARTICLE_STATUSES.INDEXED, "Normal article should not be touched");
  });

  await t.test("should not update DB or post to discord in dry-run mode", async () => {
    await prisma.article.deleteMany({});
    await saveArticle(
      { id: "digest-3", type: "news.article", topic: "toronto-eats", title: "Review 3", sourceName: "Source A" },
      30, null, ARTICLE_STATUSES.DIGEST_PENDING, null, undefined, undefined, undefined, undefined, undefined, undefined,
      { intent: "aggregate", intentConfidence: 0.9, route: "digest_pending", routeReason: "test" }
    );

    let discordCalled = false;
    const mockClient = {
      channels: { fetch: async () => { discordCalled = true; return null; } },
    } as any;

    // Call with isDryRun = true
    await publishDigestForLane(mockClient, mockConfig, "toronto-eats", "aggregate", true);

    assert.equal(discordCalled, false, "Discord should not be called in dry-run mode");
    
    const art3 = await prisma.article.findUnique({ where: { id_topic: { id: "digest-3", topic: "toronto-eats" } } });
    assert.equal(art3?.status, ARTICLE_STATUSES.DIGEST_PENDING, "DB should not be updated in dry-run mode");
  });

  await t.test("startDigestSchedulers should correctly initialize tasks", () => {
    const tasks = cron.getTasks();
    const initialTaskCount = tasks.size;
    
    startDigestSchedulers({} as any, mockConfig);
    
    // Should have created one cron task for the aggregate lane
    const newTasks = cron.getTasks();
    assert.equal(newTasks.size, initialTaskCount + 1);

    // Stop the task so the process can exit
    if (newTasks.size > 0) {
      const taskArr = Array.from(newTasks.values());
      taskArr[taskArr.length - 1].stop();
    }
  });
});
