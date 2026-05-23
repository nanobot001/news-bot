import { execSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { formatArticleEmbed, postArticleToChannel } from "../src/bot/postEmbed.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

// Force test database configuration for database-touching command tests
const TEST_DB_URL = "file:./dev-test-bot.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle } from "../src/storage/articleRepo.js";
import {
  getCommandRegistrationPayloads,
  handlePingCommand,
  handleLastpostsCommand,
  handleReloadconfigCommand,
  handleTestfeedCommand,
  pingCommand,
  testfeedCommand,
  lastpostsCommand,
  reloadconfigCommand
} from "../src/bot/commands.js";
import type { AppConfig } from "../src/config/loadConfig.js";

before(async () => {
  console.log("Setting up isolated bot test database...");
  cleanUpTestFiles();

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

    const payloads = getCommandRegistrationPayloads();
    assert.equal(payloads.length, 4);
    assert.equal(payloads[0].name, "ping");
    assert.equal(payloads[1].name, "testfeed");
    assert.equal(payloads[2].name, "lastposts");
    assert.equal(payloads[3].name, "reload-config");
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
    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
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

    // Verify config was mutated in place (it loaded anime/movies topics from dev topics.json)
    assert.ok(!mockConfig.topics.old);
    assert.ok(mockConfig.topics.anime || mockConfig.topics.movies);
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

  await t.test("handleLastpostsCommand should handle unknown topic gracefully", async () => {
    let replied = false;
    let replyContent = "";

    const mockInteraction: any = {
      options: {
        getString: (name: string) => {
          if (name === "topic") return "nonexistent-topic";
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
    let deferred = false;
    let editedReply = false;
    let replyContent = "";

    const mockInteraction: any = {
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
  });
});
