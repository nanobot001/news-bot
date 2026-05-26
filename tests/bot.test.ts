import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { formatArticleEmbed, postArticleToChannel } from "../src/bot/postEmbed.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";
import { ARTICLE_STATUSES } from "../src/storage/articleStatus.js";

// Force test database configuration for database-touching command tests
const TEST_DB_URL = "file:./dev-test-bot.db";
const TEST_DB_FILE = "./prisma/dev-test-bot.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle } from "../src/storage/articleRepo.js";
import {
  getCommandRegistrationPayloads,
  handlePingCommand,
  handleLastpostsCommand,
  handleReloadconfigCommand,
  handleTestfeedCommand,
  handleRefreshCommand,
  handleStatsCommand,
  handleSearchCommand,
  handleTopicsCommand,
  handleSourcesCommand,
  handleFavoritesCommand,
  handleUnfavoriteCommand,
  pingCommand,
  testfeedCommand,
  lastpostsCommand,
  reloadconfigCommand,
  refreshCommand,
  statsCommand,
  searchCommand,
  topicsCommand,
  sourcesCommand,
  favoritesCommand,
  unfavoriteCommand
} from "../src/bot/commands.js";
import type { AppConfig } from "../src/config/loadConfig.js";

before(async () => {
  console.log("Setting up isolated bot test database...");
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
  console.log("Cleaning up bot test database...");
  await prisma.$disconnect();
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-bot.db",
    "./prisma/dev-test-bot.db-journal",
    "./dev-test-bot.db",
    "./dev-test-bot.db-journal",
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

test("Discord Embed Formatting", async (t) => {
  await t.test("should format article embed correctly under production rules", () => {
    // Force NODE_ENV to production temporarily
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    
    try {
      const event: NormalizedEvent = {
        id: "test-id",
        type: "news.article",
        topic: "anime",
        title: "New Anime Announcement",
        url: "https://example.com/anime/new-show",
        sourceName: "AnimeNewsNetwork",
        publishedAt: "2026-05-23T12:00:00.000Z",
        summary: "A brand new anime adaptation is scheduled for next year.",
      };
      
      const embed = formatArticleEmbed({ event, score: 75 });
      const data = embed.toJSON();
      
      assert.equal(data.title, "New Anime Announcement");
      assert.equal(data.url, "https://example.com/anime/new-show");
      assert.equal(data.author?.name, "AnimeNewsNetwork");
      assert.equal(data.description, "A brand new anime adaptation is scheduled for next year.");
      assert.equal(data.color, 5793266); // 0x5865F2 in decimal
      // Verify no footer in production
      assert.equal(data.footer, undefined);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  await t.test("should format article embed with dev footer under development rules", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    
    try {
      const event: NormalizedEvent = {
        id: "test-id",
        type: "news.article",
        topic: "movies",
        title: "Marvel Movie Trailer",
        url: "https://example.com/movies/marvel",
        sourceName: "Hollywood Reporter",
        publishedAt: "2026-05-23T12:00:00.000Z",
        summary: "The latest trailer reveals new characters.",
      };
      
      const embed = formatArticleEmbed({ event, score: 90 });
      const data = embed.toJSON();
      
      assert.equal(data.title, "Marvel Movie Trailer");
      assert.equal(data.footer?.text, "Score: 90 | Topic: movies (Dev Mode)");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  await t.test("should handle missing optional summary and publishedAt fields gracefully", () => {
    const event: NormalizedEvent = {
      id: "test-id-minimal",
      type: "news.article",
      topic: "anime",
      title: "Minimal Title",
      url: "https://example.com/minimal",
      sourceName: "Minimal Source",
    };
    
    const embed = formatArticleEmbed({ event, score: 40 });
    const data = embed.toJSON();
    
    assert.equal(data.title, "Minimal Title");
    assert.equal(data.description, undefined);
    assert.equal(data.timestamp, undefined);
  });

  await t.test("should set YouTube thumbnail image if URL is a YouTube video", () => {
    const event: NormalizedEvent = {
      id: "yt-test",
      type: "news.article",
      topic: "jays",
      title: "Blue Jays YouTube Video",
      url: "https://www.youtube.com/watch?v=UCVPkZh_H6m_stW8hq-2-yNw",
      sourceName: "Toronto Blue Jays YouTube",
    };

    const embed = formatArticleEmbed({ event, score: 50 });
    const data = embed.toJSON();

    assert.equal(data.image?.url, "https://img.youtube.com/vi/UCVPkZh_H6m_stW8hq-2-yNw/hqdefault.jpg");
  });

  await t.test("should prefix the embed title with an inline topic emoji", () => {
    const event: NormalizedEvent = {
      id: "emoji-test",
      type: "news.article",
      topic: "ai",
      title: "AI Story",
      url: "https://example.com/ai/story",
      sourceName: "AI Source",
    };

    const embed = formatArticleEmbed({ event, score: 80, emoji: "<:ai:12345>" });
    const data = embed.toJSON();

    assert.equal(data.title, "<:ai:12345> AI Story");
  });
});

test("Discord Message Posting (Mocked)", async (t) => {
  await t.test("should fetch text channel and send the embed", async () => {
    let sentPayload: any = null;
    let fetchedChannelId: string | null = null;

    // Create a mock channel that is text-based
    const mockChannel = {
      isTextBased() { return true; },
      send(payload: any) {
        sentPayload = payload;
        return Promise.resolve({});
      }
    };

    // Create a mock client
    const mockClient = {
      channels: {
        fetch(channelId: string) {
          fetchedChannelId = channelId;
          return Promise.resolve(mockChannel);
        }
      }
    } as any;

    const event: NormalizedEvent = {
      id: "test-id",
      type: "news.article",
      topic: "anime",
      title: "Test Title",
      url: "https://example.com/test",
      sourceName: "Test Source",
    };
    const embed = formatArticleEmbed({ event, score: 80 });

    await postArticleToChannel(mockClient, "1234567890", embed);

    assert.equal(fetchedChannelId, "1234567890");
    assert.ok(sentPayload);
    assert.ok(sentPayload.embeds);
    assert.equal(sentPayload.embeds[0], embed);
    assert.equal(sentPayload.content, undefined);
  });

  await t.test("should fetch text channel and send an emoji-prefixed embed without message content", async () => {
    let sentPayload: any = null;
    let fetchedChannelId: string | null = null;

    const mockChannel = {
      isTextBased() { return true; },
      send(payload: any) {
        sentPayload = payload;
        return Promise.resolve({});
      }
    };

    const mockClient = {
      channels: {
        fetch(channelId: string) {
          fetchedChannelId = channelId;
          return Promise.resolve(mockChannel);
        }
      }
    } as any;

    const event: NormalizedEvent = {
      id: "test-id",
      type: "news.article",
      topic: "anime",
      title: "Test Title",
      url: "https://example.com/test",
      sourceName: "Test Source",
    };
    const embed = formatArticleEmbed({ event, score: 80, emoji: "<:emoji:12345>" });

    await postArticleToChannel(mockClient, "1234567890", embed);

    assert.equal(fetchedChannelId, "1234567890");
    assert.ok(sentPayload);
    assert.ok(sentPayload.embeds);
    assert.equal(sentPayload.embeds[0], embed);
    assert.equal(sentPayload.content, undefined);
    assert.equal(sentPayload.embeds[0].data.title, "<:emoji:12345> Test Title");
  });

  await t.test("should throw error if channel is not found", async () => {
    const mockClient = {
      channels: {
        fetch(channelId: string) {
          return Promise.resolve(null);
        }
      }
    } as any;

    const event: NormalizedEvent = {
      id: "test-id",
      type: "news.article",
      topic: "anime",
      title: "Test Title",
      url: "https://example.com/test",
      sourceName: "Test Source",
    };
    const embed = formatArticleEmbed({ event, score: 80 });

    await assert.rejects(
      postArticleToChannel(mockClient, "unknown-channel", embed),
      /Channel not found in Discord: unknown-channel/
    );
  });

  await t.test("should throw error if channel is not text-based", async () => {
    const mockChannel = {
      isTextBased() { return false; }
    };
    const mockClient = {
      channels: {
        fetch(channelId: string) {
          return Promise.resolve(mockChannel);
        }
      }
    } as any;

    const event: NormalizedEvent = {
      id: "test-id",
      type: "news.article",
      topic: "anime",
      title: "Test Title",
      url: "https://example.com/test",
      sourceName: "Test Source",
    };
    const embed = formatArticleEmbed({ event, score: 80 });

    await assert.rejects(
      postArticleToChannel(mockClient, "voice-channel", embed),
      /Channel is not text-based: voice-channel/
    );
  });
});

test("Slash Commands System", async (t) => {
  await t.test("should export correct builders and payloads", () => {
    assert.equal(pingCommand.name, "ping");
    assert.equal(testfeedCommand.name, "testfeed");
    assert.equal(lastpostsCommand.name, "lastposts");
    assert.equal(reloadconfigCommand.name, "reload-config");
    assert.equal(refreshCommand.name, "refresh");
    assert.equal(statsCommand.name, "stats");
    assert.equal(searchCommand.name, "search");
    assert.equal(topicsCommand.name, "topics");
    assert.equal(sourcesCommand.name, "sources");
    assert.equal(favoritesCommand.name, "favorites");
    assert.equal(unfavoriteCommand.name, "unfavorite");

    const payloads = getCommandRegistrationPayloads();
    assert.equal(payloads.length, 12);
    assert.equal(payloads[0].name, "ping");
    assert.equal(payloads[1].name, "testfeed");
    assert.equal(payloads[2].name, "lastposts");
    assert.equal(payloads[3].name, "reload-config");
    assert.equal(payloads[4].name, "refresh");
    assert.equal(payloads[5].name, "stats");
    assert.equal(payloads[6].name, "search");
    assert.equal(payloads[7].name, "topics");
    assert.equal(payloads[8].name, "sources");
    assert.equal(payloads[9].name, "favorites");
    assert.equal(payloads[10].name, "unfavorite");
    assert.equal(payloads[11].name, "audit");
  });

  await t.test("handlePingCommand should reply with pong", async () => {
    let replied = false;
    let replyPayload: any = null;
    const mockInteraction: any = {
      reply: async (payload: any) => {
        replied = true;
        replyPayload = payload;
      }
    };

    await handlePingCommand(mockInteraction);
    assert.ok(replied);
    assert.equal(replyPayload.content, "Pong. News bot shell is running.");
    assert.equal(replyPayload.ephemeral, true);
  });

  await t.test("handleReloadconfigCommand should reload config in-place", async () => {
    const originalManagerIds = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "test-user-123";

    try {
      let deferred = false;
      let editedReply = false;
      let replyContent = "";

      const mockInteraction: any = {
        user: { id: "test-user-123" },
        deferReply: async (options: any) => {
          deferred = true;
          assert.equal(options?.ephemeral, true);
        },
        editReply: async (options: any) => {
          editedReply = true;
          replyContent = typeof options === "string" ? options : options.content;
        }
      };

      const mockConfig: AppConfig = {
        topics: { old: { channelId: "1", keywords: [], blockedTerms: [], postThreshold: 0 } },
        sources: { old: [] }
      };

      await handleReloadconfigCommand(mockInteraction, mockConfig);
      assert.ok(deferred);
      assert.ok(editedReply);
      assert.match(replyContent, /Successfully reloaded configuration/);

      // Verify config was mutated in place (it loaded topics from dev topics.json)
      assert.ok(!mockConfig.topics.old);
      assert.ok(Object.keys(mockConfig.topics).length > 0);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalManagerIds;
    }
  });

  await t.test("handleLastpostsCommand should list recently posted articles", async () => {
    await prisma.article.deleteMany({});

    // Save a test article that was posted
    const mockArticle = {
      id: "art-1",
      type: "news.article",
      topic: "anime",
      title: "Slash Command Test",
      url: "https://example.com/slash",
      sourceName: "Slash Source",
    };
    await saveArticle(mockArticle, 85, new Date());

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string) => {
          if (name === "topic") return "anime";
          return null;
        },
        getInteger: (name: string) => {
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
        assert.equal(options?.ephemeral, true);
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleLastpostsCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Slash Command Test/);
    assert.match(replyContent, /Score: 85/);
  });

  await t.test("handleLastpostsCommand should respect unposted status and timeframe options", async () => {
    await prisma.article.deleteMany({});

    // Save a test article that was skipped (unposted)
    const mockArticle = {
      id: "art-unposted",
      type: "news.article",
      topic: "anime",
      title: "Unposted Test",
      url: "https://example.com/unposted",
      sourceName: "Slash Source",
    };
    await saveArticle(mockArticle, 40, null, ARTICLE_STATUSES.SKIPPED_LOW_SCORE);

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string) => {
          if (name === "topic") return "anime";
          if (name === "status") return "unposted";
          return null;
        },
        getInteger: (name: string) => {
          if (name === "hours") return 5;
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 50 } },
      sources: { anime: [] }
    };

    await handleLastpostsCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Unposted Test/);
    assert.match(replyContent, /Score: 40/);
    assert.match(replyContent, /Skipped: low score/);
  });

  await t.test("handleLastpostsCommand should handle unknown topic gracefully", async () => {
    let replied = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string) => {
          if (name === "topic") return "nonexistent-topic";
          return null;
        },
        getInteger: (name: string) => {
          return null;
        }
      },
      reply: async (options: any) => {
        replied = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleLastpostsCommand(mockInteraction, mockConfig);
    assert.ok(replied);
    assert.match(replyContent, /Unknown topic/);
  });

  await t.test("handleTestfeedCommand should execute test run", async () => {
    const originalManagerIds = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "test-user-123";

    try {
      let deferred = false;
      let editedReply = false;
      let replyContent = "";

      const mockInteraction: any = {
        user: { id: "test-user-123" },
        options: {
          getString: (name: string) => {
            if (name === "topic") return "anime";
            return null;
          }
        },
        deferReply: async (options: any) => {
          deferred = true;
          assert.equal(options?.ephemeral, true);
        },
        editReply: async (options: any) => {
          editedReply = true;
          replyContent = typeof options === "string" ? options : options.content;
        }
      };

      const mockClient: any = {
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async () => ({ id: "mock" })
          })
        }
      };

      const mockConfig: AppConfig = {
        topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
        sources: { anime: [] }
      };

      await handleTestfeedCommand(mockInteraction, mockClient, mockConfig);
      assert.ok(deferred);
      assert.ok(editedReply);
      assert.match(replyContent, /Diagnostic Test Run for Topic/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalManagerIds;
    }
  });

  await t.test("handleRefreshCommand should execute refresh run", async () => {
    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string) => {
          if (name === "topic") return null;
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockClient: any = {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          send: async () => ({ id: "mock" })
        })
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleRefreshCommand(mockInteraction, mockClient, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Feed Refresh Complete/);
  });

  await t.test("handleStatsCommand should query database totals", async () => {
    await prisma.article.deleteMany({});

    // Seed test articles
    const mock1 = { id: "stats-1", type: "news.article", topic: "anime", title: "Stats 1", url: "https://example.com/stats1", sourceName: "Stats Source" };
    const mock2 = { id: "stats-2", type: "news.article", topic: "ai", title: "Stats 2", url: "https://example.com/stats2", sourceName: "Stats Source" };
    await saveArticle(mock1, 80, new Date()); // posted
    await saveArticle(mock2, 10, null); // not posted

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: {
        anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 50 },
        ai: { channelId: "456", keywords: [], blockedTerms: [], postThreshold: 50 }
      },
      sources: { anime: [], ai: [] }
    };

    await handleStatsCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Total Indexed Articles: \*\*2\*\*/);
    assert.match(replyContent, /Total Posted to Discord: \*\*1\*\*/);
    assert.match(replyContent, /Total Skipped\/Deduplicated: \*\*1\*\*/);
  });

  await t.test("handleSearchCommand should find matching articles", async () => {
    await prisma.article.deleteMany({});

    const mock1 = { id: "search-1", type: "news.article", topic: "anime", title: "Unique Anime Magic Title", url: "https://example.com/search1", sourceName: "Search Source" };
    await saveArticle(mock1, 90, new Date());

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string, required?: boolean) => {
          if (name === "query") return "Unique Anime Magic";
          if (name === "topic") return null;
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleSearchCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Unique Anime Magic Title/);
    assert.match(replyContent, /Posted/);
  });

  await t.test("handleSearchCommand should show persisted skip reasons", async () => {
    await prisma.article.deleteMany({});

    const mock1 = {
      id: "search-skip-1",
      type: "news.article",
      topic: "jays",
      title: "Blue Jays Pinango Search Skip",
      url: "https://example.com/search-skip",
      sourceName: "Search Source",
    };
    await saveArticle(
      mock1,
      45,
      null,
      ARTICLE_STATUSES.SKIPPED_OLD,
      "Article age of 25.6 hours exceeds max age of 24 hours"
    );

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string, required?: boolean) => {
          if (name === "query") return "Pinango";
          if (name === "topic") return "jays";
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { jays: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 20 } },
      sources: { jays: [] }
    };

    await handleSearchCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Blue Jays Pinango Search Skip/);
    assert.match(replyContent, /Score: 45/);
    assert.match(replyContent, /Skipped: too old/);
    assert.match(replyContent, /25\.6 hours exceeds max age of 24 hours/);
  });

  await t.test("handleSearchCommand should handle no results gracefully", async () => {
    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string, required?: boolean) => {
          if (name === "query") return "NoMatchingStuffTextHere";
          if (name === "topic") return null;
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleSearchCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /No articles matching/);
  });

  await t.test("handleTopicsCommand should list topic settings", async () => {
    let replied = false;
    let replyContent = "";

    const mockInteraction: any = {
      reply: async (options: any) => {
        replied = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: {
        anime: { channelId: "12345", keywords: ["magic", "goku"], blockedTerms: ["boring"], postThreshold: 70, emoji: "<:anime:9876>" }
      },
      sources: { anime: [] }
    };

    await handleTopicsCommand(mockInteraction, mockConfig);
    assert.ok(replied);
    assert.match(replyContent, /Configured News Topics/);
    assert.match(replyContent, /Emoji: <:anime:9876>/);
    assert.match(replyContent, /Threshold: `70`/);
    assert.match(replyContent, /Keywords \(2\): `magic`, `goku`/);
    assert.match(replyContent, /Blocked Terms \(1\): `boring`/);
  });

  await t.test("handleTopicsCommand should truncate keywords and blocked terms when they exceed 10 items", async () => {
    let replied = false;
    let replyContent = "";

    const mockInteraction: any = {
      reply: async (options: any) => {
        replied = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: {
        anime: {
          channelId: "12345",
          keywords: ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11", "k12"],
          blockedTerms: ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11"],
          postThreshold: 70
        }
      },
      sources: { anime: [] }
    };

    await handleTopicsCommand(mockInteraction, mockConfig);
    assert.ok(replied);
    assert.match(replyContent, /Keywords \(12\): `k1`, `k2`[\s\S]+, ... and 2 more/);
    assert.match(replyContent, /Blocked Terms \(11\): `b1`, `b2`[\s\S]+, ... and 1 more/);
  });

  await t.test("handleSourcesCommand should list sources", async () => {
    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string) => {
          if (name === "topic") return null;
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: {
        anime: [
          { name: "Feed 1", url: "https://example.com/feed1", trusted: true },
          { name: "Feed 2", url: "https://example.com/feed2", trusted: false }
        ]
      }
    };

    await handleSourcesCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Feed 1.*https:\/\/example.com\/feed1/);
    assert.match(replyContent, /Feed 2.*https:\/\/example.com\/feed2/);
    assert.match(replyContent, /trusted/);
  });

  await t.test("handleFavoritesCommand should list user's favorites", async () => {
    await prisma.userFavorite.deleteMany({});
    await prisma.article.deleteMany({});

    const mockArticle = {
      id: "art-fav-test-1",
      type: "news.article",
      topic: "anime",
      title: "Anime Favorite Test Title",
      url: "https://example.com/anime-fav",
      sourceName: "Anime Source",
    };
    await saveArticle(mockArticle, 85, new Date(), "POSTED", undefined, "msg-fav-1", "chan-fav-1");

    await prisma.userFavorite.create({
      data: {
        userId: "test-user-123",
        articleId: "art-fav-test-1",
        articleTopic: "anime",
        discordChannelId: "chan-fav-1",
        discordMessageId: "msg-fav-1",
        instapaperStatus: "SUCCESS",
        savedAt: new Date(),
      }
    });

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      user: { id: "test-user-123" },
      options: {
        getString: (name: string) => {
          return null;
        },
        getInteger: (name: string) => {
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
        assert.equal(options?.ephemeral, true);
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleFavoritesCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Anime Favorite Test Title/);
    assert.match(replyContent, /Anime Source/);
    assert.match(replyContent, /Instapaper/);
  });

  await t.test("handleFavoritesCommand should return empty message when no favorites exist", async () => {
    await prisma.userFavorite.deleteMany({});
    await prisma.article.deleteMany({});

    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
      user: { id: "test-user-123" },
      options: {
        getString: (name: string) => {
          return null;
        },
        getInteger: (name: string) => {
          return null;
        }
      },
      deferReply: async (options: any) => {
        deferred = true;
      },
      editReply: async (options: any) => {
        editedReply = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleFavoritesCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /You don't have any matching favorited articles yet/);
  });

  await t.test("handleFavoritesCommand should error on unknown topic", async () => {
    let replied = false;
    let replyContent = "";

    const mockInteraction: any = {
      user: { id: "test-user-123" },
      options: {
        getString: (name: string) => {
          if (name === "topic") return "unknown-topic";
          return null;
        },
        getInteger: (name: string) => {
          return null;
        }
      },
      reply: async (options: any) => {
        replied = true;
        replyContent = typeof options === "string" ? options : options.content;
      }
    };

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: [] }
    };

    await handleFavoritesCommand(mockInteraction, mockConfig);
    assert.ok(replied);
    assert.match(replyContent, /Unknown topic/);
  });
});
