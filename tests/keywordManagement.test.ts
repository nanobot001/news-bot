import { copyFile, rm, writeFile } from "node:fs/promises";
import { existsSync, closeSync, openSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

// 1. Force the test database URL before importing prisma or repository modules
// 1. Force the test database URL before importing prisma or repository modules
const TEST_DB_URL = "file:./dev-test-keyword.db";
const TEST_DB_FILE = "./prisma/dev-test-keyword.db"; // SQLite relative to prisma directory/project root
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle } from "../src/storage/articleRepo.js";
import {
  handleKeywordCommand,
  handleRefreshCommand
} from "../src/bot/commands.js";
import { type AppConfig, reloadAppConfig } from "../src/config/loadConfig.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

// Backup and restore config helper
const TOPICS_PATH = "src/config/topics.json";
const SOURCES_PATH = "src/config/sources.json";
const TOPICS_BAK = "src/config/topics.json.bak";
const SOURCES_BAK = "src/config/sources.json.bak";

before(async () => {
  console.log("Setting up isolated test database for keywordManagement...");
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

  // Backup actual configs
  if (existsSync(TOPICS_PATH)) {
    await copyFile(TOPICS_PATH, TOPICS_BAK);
  }
  if (existsSync(SOURCES_PATH)) {
    await copyFile(SOURCES_PATH, SOURCES_BAK);
  }

  // Write basic test initial state
  const testTopics = {
    anime: {
      channelId: "11111111",
      keywords: ["naruto", "one piece"],
      blockedTerms: ["filler"],
      postThreshold: 20,
      emoji: "📺"
    },
    tech: {
      channelId: "22222222",
      keywords: ["ai", "rust"],
      locationKeywords: ["toronto"],
      blockedTerms: [],
      postThreshold: 50
    }
  };

  const testSources = {
    anime: [],
    tech: []
  };

  await writeFile(TOPICS_PATH, JSON.stringify(testTopics, null, 2), "utf8");
  await writeFile(SOURCES_PATH, JSON.stringify(testSources, null, 2), "utf8");
});

after(async () => {
  console.log("Cleaning up database and restoring original configs...");
  await prisma.$disconnect();
  cleanUpTestFiles();

  // Restore original configs
  if (existsSync(TOPICS_BAK)) {
    await copyFile(TOPICS_BAK, TOPICS_PATH);
    await rm(TOPICS_BAK);
  } else if (existsSync(TOPICS_PATH)) {
    await rm(TOPICS_PATH);
  }

  if (existsSync(SOURCES_BAK)) {
    await copyFile(SOURCES_BAK, SOURCES_PATH);
    await rm(SOURCES_BAK);
  } else if (existsSync(SOURCES_PATH)) {
    await rm(SOURCES_PATH);
  }
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-keyword.db",
    "./prisma/dev-test-keyword.db-journal",
    "./dev-test-keyword.db",
    "./dev-test-keyword.db-journal",
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

// Mock builder helper
function createMockInteraction(options: {
  userId?: string;
  subcommand?: string;
  optionsMap: Record<string, any>;
  onReply?: (payload: any) => Promise<any> | void;
  onEditReply?: (payload: any) => Promise<any> | void;
  onDeferReply?: (payload: any) => Promise<any> | void;
}): any {
  return {
    user: { id: options.userId ?? "9999" },
    member: { roles: { cache: new Map() } },
    options: {
      getSubcommand: () => options.subcommand ?? "",
      getString: (name: string) => options.optionsMap[name] ?? null,
      getInteger: (name: string) => options.optionsMap[name] ?? null,
      getBoolean: (name: string) => options.optionsMap[name] ?? null,
      getChannel: (name: string) => options.optionsMap[name] ?? null,
    },
    reply: async (payload: any) => {
      if (options.onReply) return options.onReply(payload);
      return {};
    },
    deferReply: async (payload: any) => {
      if (options.onDeferReply) return options.onDeferReply(payload);
      return {};
    },
    editReply: async (payload: any) => {
      if (options.onEditReply) return options.onEditReply(payload);
      return {};
    }
  };
}

test("Topic Keyword Management and Refresh Lookback Suite", async (t) => {
  let appConfig: AppConfig;

  before(async () => {
    // Load config from the test initial state
    appConfig = {
      topics: {
        anime: { channelId: "11111111", keywords: ["naruto", "one piece"], blockedTerms: ["filler"], postThreshold: 20, emoji: "📺" },
        tech: { channelId: "22222222", keywords: ["ai", "rust"], locationKeywords: ["toronto"], blockedTerms: [], postThreshold: 50 }
      },
      sources: {
        anime: [],
        tech: []
      }
    };
  });

  await t.test("view keywords for a topic - open to non-managers", async () => {
    let replied = false;
    let replyContent = "";

    const interaction = createMockInteraction({
      userId: "12345", // Non-manager
      subcommand: "view",
      optionsMap: { topic: "tech" },
      onReply: (payload) => {
        replied = true;
        replyContent = typeof payload === "string" ? payload : payload.content;
      }
    });

    await handleKeywordCommand(interaction, appConfig);
    assert.ok(replied);
    assert.match(replyContent, /Keywords for Topic Lane: \*\*tech\*\*/);
    assert.match(replyContent, /ai.*rust/);
    assert.match(replyContent, /toronto/);
    assert.ok(replyContent.includes("Negative Keywords (0)"));
  });

  await t.test("add/remove keywords - denies non-managers", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999"; // restricts manager to 9999

    try {
      // Test add
      let repliedAdd = false;
      let replyContentAdd = "";
      const interactionAdd = createMockInteraction({
        userId: "12345", // non-manager
        subcommand: "add",
        optionsMap: { topic: "tech", keyword: "typescript", type: "standard" },
        onReply: (payload) => {
          repliedAdd = true;
          replyContentAdd = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interactionAdd, appConfig);
      assert.ok(repliedAdd);
      assert.match(replyContentAdd, /do not have permission/);

      // Test remove
      let repliedRemove = false;
      let replyContentRemove = "";
      const interactionRemove = createMockInteraction({
        userId: "12345", // non-manager
        subcommand: "remove",
        optionsMap: { topic: "tech", keyword: "rust", type: "standard" },
        onReply: (payload) => {
          repliedRemove = true;
          replyContentRemove = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interactionRemove, appConfig);
      assert.ok(repliedRemove);
      assert.match(replyContentRemove, /do not have permission/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("add keyword - validates empty/whitespace only", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";
      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "add",
        optionsMap: { topic: "tech", keyword: "   ", type: "standard" },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /Keyword cannot be empty/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("add keyword - trims, lowercases and persists standard keyword", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "add",
        optionsMap: { topic: "tech", keyword: "  TypeScript  ", type: "standard" },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully added \*\*standard\*\* keyword `typescript`/);

      // Verify in-memory reload
      assert.ok(appConfig.topics.tech.keywords.includes("typescript"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("add keyword - trims, lowercases and persists location keyword", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "add",
        optionsMap: { topic: "tech", keyword: "  VancouveR  ", type: "location" },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully added \*\*location\*\* keyword `vancouver`/);

      // Verify in-memory reload
      assert.ok(appConfig.topics.tech.locationKeywords?.includes("vancouver"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("add keyword - validates case-insensitive duplicates", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";
      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "add",
        optionsMap: { topic: "tech", keyword: "ai", type: "standard" },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /keyword `ai` already exists/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("remove keyword - validates non-existent keyword", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";
      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "remove",
        optionsMap: { topic: "tech", keyword: "nonexistent", type: "standard" },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /keyword `nonexistent` does not exist/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("remove keyword - trims, lowercases and deletes standard keyword", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "remove",
        optionsMap: { topic: "tech", keyword: "  TypeScript  ", type: "standard" },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully removed \*\*standard\*\* keyword `typescript`/);

      // Verify in-memory reload
      assert.ok(!appConfig.topics.tech.keywords.includes("typescript"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("add keyword - trims, lowercases and persists negative keyword", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "add",
        optionsMap: { topic: "tech", keyword: "  SPAMMY  ", type: "negative" },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully added \*\*negative\*\* keyword `spammy`/);

      // Verify in-memory reload
      assert.ok(appConfig.topics.tech.blockedTerms.includes("spammy"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("remove keyword - trims, lowercases and deletes negative keyword", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999", // manager
        subcommand: "remove",
        optionsMap: { topic: "tech", keyword: "  SPAMMY  ", type: "negative" },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully removed \*\*negative\*\* keyword `spammy`/);

      // Verify in-memory reload
      assert.ok(!appConfig.topics.tech.blockedTerms.includes("spammy"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("refresh command - lookback validation rules", async () => {
    // 1. Error: hours specified but no topic
    let repliedNoTopic = false;
    let replyContentNoTopic = "";
    let interaction = createMockInteraction({
      optionsMap: { hours: 12 },
      onReply: (payload) => {
        repliedNoTopic = true;
        replyContentNoTopic = typeof payload === "string" ? payload : payload.content;
      }
    });
    await handleRefreshCommand(interaction, {} as any, appConfig);
    assert.ok(repliedNoTopic);
    assert.match(replyContentNoTopic, /must specify a `topic`/);

    // 2. Error: hours <= 0
    let repliedNonPos = false;
    let replyContentNonPos = "";
    interaction = createMockInteraction({
      optionsMap: { topic: "tech", hours: -5 },
      onReply: (payload) => {
        repliedNonPos = true;
        replyContentNonPos = typeof payload === "string" ? payload : payload.content;
      }
    });
    await handleRefreshCommand(interaction, {} as any, appConfig);
    assert.ok(repliedNonPos);
    assert.match(replyContentNonPos, /must be a positive integer/);

    // 3. Error: hours > 72
    let repliedTooLarge = false;
    let replyContentTooLarge = "";
    interaction = createMockInteraction({
      optionsMap: { topic: "tech", hours: 73 },
      onReply: (payload) => {
        repliedTooLarge = true;
        replyContentTooLarge = typeof payload === "string" ? payload : payload.content;
      }
    });
    await handleRefreshCommand(interaction, {} as any, appConfig);
    assert.ok(repliedTooLarge);
    assert.match(replyContentTooLarge, /window cannot exceed 72 hours/);
  });

  await t.test("refresh command - previews historical rescore outcomes without posting", async () => {
    // Ensure database clean
    await prisma.article.deleteMany({});

    // Seed historical articles for tech:
    // Article 1: meets post threshold (ai keyword (+20), location keyword (+20), and trusted source (+15) = 55, threshold is 50)
    // Article 2: below post threshold (no keyword matches, score 0)
    // Article 3: already posted (should be ignored during refresh rescoring)

    const article1: NormalizedEvent = {
      id: "hist-1",
      type: "news.article",
      topic: "tech",
      title: "New AI tool released in Toronto",
      url: "https://example.com/ai-tool",
      sourceName: "Tech News Daily",
      publishedAt: new Date().toISOString()
    };

    const article2: NormalizedEvent = {
      id: "hist-2",
      type: "news.article",
      topic: "tech",
      title: "Random story about coding",
      url: "https://example.com/coding",
      sourceName: "Unrelated Blog",
      publishedAt: new Date().toISOString()
    };

    const article3: NormalizedEvent = {
      id: "hist-3",
      type: "news.article",
      topic: "tech",
      title: "Another AI breakthrough",
      url: "https://example.com/ai-breakthrough",
      sourceName: "Tech News Daily",
      publishedAt: new Date().toISOString()
    };

    // Save articles directly using saveArticle helper
    await saveArticle(article1, 0, null, "SKIPPED_LOW_SCORE"); // initial status skipped
    await saveArticle(article2, 0, null, "SKIPPED_LOW_SCORE");
    await saveArticle(article3, 55, new Date(), "POSTED"); // already posted

    // Set tech sources to contain trusted source
    const appConfigWithTrusted = {
      ...appConfig,
      sources: {
        anime: [],
        tech: [
          { name: "Tech News Daily", url: "https://example.com/rss", trusted: true }
        ]
      }
    };

    // Mock discord client to verify preview mode does not send
    let postTriggered = false;
    let postEmbed: any = null;
    const mockChannel = {
      isTextBased: () => true,
      send: async (payload: any) => {
        postTriggered = true;
        postEmbed = payload.embeds[0];
        return { id: "msg-12345", channelId: "22222222" };
      }
    };
    const mockClient = {
      channels: {
        fetch: async () => mockChannel
      }
    } as any;

    let deferred = false;
    let edited = false;
    let editContent = "";

    const interaction = createMockInteraction({
      optionsMap: { topic: "tech", hours: 24 },
      onDeferReply: () => { deferred = true; },
      onEditReply: (payload) => {
        edited = true;
        editContent = typeof payload === "string" ? payload : payload.content;
      }
    });

    // Run refresh with hours lookback
    await handleRefreshCommand(interaction, mockClient, appConfigWithTrusted);

    assert.ok(deferred);
    assert.ok(edited);

    // Verify stats in message
    assert.match(editContent, /Articles Checked.*\b3/);
    assert.match(editContent, /Already Posted.*\b1/);
    assert.match(editContent, /Would Post Now.*\b1/);
    assert.match(editContent, /Would Route To Digest\/Review.*\b0/);
    assert.match(editContent, /Still Skipped By Filter.*\b1/);

    // Verify preview does not post or mutate article state
    assert.equal(postTriggered, false);
    assert.equal(postEmbed, null);

    // Verify DB states after rescoring
    const dbArticle1 = await prisma.article.findUnique({
      where: { id_topic: { id: "hist-1", topic: "tech" } }
    });
    assert.ok(dbArticle1);
    assert.equal(dbArticle1.status, "SKIPPED_LOW_SCORE");
    assert.equal(dbArticle1.postedAt, null);
    assert.equal(dbArticle1.discordMessageId, null);
    assert.equal(dbArticle1.discordChannelId, null);

    const dbArticle2 = await prisma.article.findUnique({
      where: { id_topic: { id: "hist-2", topic: "tech" } }
    });
    assert.ok(dbArticle2);
    assert.equal(dbArticle2.status, "SKIPPED_LOW_SCORE");
    assert.equal(dbArticle2.postedAt, null);
  });

  await t.test("add keyword - multi-topic batch update", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let appConfig: AppConfig = {
        topics: {
          anime: {
            channelId: "11111111",
            keywords: ["naruto"],
            blockedTerms: [],
            postThreshold: 20
          },
          tech: {
            channelId: "22222222",
            keywords: ["rust"],
            blockedTerms: [],
            postThreshold: 50
          }
        },
        sources: {}
      };

      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        subcommand: "add",
        optionsMap: {
          topic: "tech, anime",
          keyword: "golang",
          type: "standard"
        },
        onDeferReply: () => {
          deferred = true;
        },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);

      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully updated keywords/);
      assert.match(editContent, /• \*\*tech\*\*: Added: `golang`/);
      assert.match(editContent, /• \*\*anime\*\*: Added: `golang`/);

      // Verify config reloaded
      assert.ok(appConfig.topics.tech.keywords.includes("golang"));
      assert.ok(appConfig.topics.anime.keywords.includes("golang"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("remove keyword - multi-topic batch update", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let appConfig: AppConfig = {
        topics: {
          anime: {
            channelId: "11111111",
            keywords: ["naruto", "golang"],
            blockedTerms: [],
            postThreshold: 20
          },
          tech: {
            channelId: "22222222",
            keywords: ["rust", "golang"],
            blockedTerms: [],
            postThreshold: 50
          }
        },
        sources: {}
      };

      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        subcommand: "remove",
        optionsMap: {
          topic: "tech, anime",
          keyword: "golang",
          type: "standard"
        },
        onDeferReply: () => {
          deferred = true;
        },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);

      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully updated keywords/);
      assert.match(editContent, /• \*\*tech\*\*: Removed: `golang`/);
      assert.match(editContent, /• \*\*anime\*\*: Removed: `golang`/);

      // Verify config reloaded/updated
      assert.ok(!appConfig.topics.tech.keywords.includes("golang"));
      assert.ok(!appConfig.topics.anime.keywords.includes("golang"));
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("add keyword - multi-topic validation failures", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let appConfig: AppConfig = {
        topics: {
          anime: {
            channelId: "11111111",
            keywords: ["naruto"],
            blockedTerms: [],
            postThreshold: 20
          },
          tech: {
            channelId: "22222222",
            keywords: ["rust"],
            blockedTerms: [],
            postThreshold: 50
          }
        },
        sources: {}
      };

      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        subcommand: "add",
        optionsMap: {
          topic: "tech, missingtopic",
          keyword: "golang",
          type: "standard"
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleKeywordCommand(interaction, appConfig);

      assert.ok(replied);
      assert.match(replyContent, /Unknown topic\(s\): "missingtopic"/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });
});
