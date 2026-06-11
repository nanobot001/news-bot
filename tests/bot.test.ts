import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import cron from "node-cron";
import { formatArticleEmbed, postArticleToChannel } from "../src/bot/postEmbed.js";
import { normalizeRssItem } from "../src/normalization/normalizeRssItem.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";
import { decodeGoogleNewsUrl } from "../src/utils/googleNewsResolver.js";
import { scrapeOgImage } from "../src/utils/ogImageScraper.js";
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
  handleTestdigestCommand,
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
  unfavoriteCommand,
  testdigestCommand
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
  const tasks = cron.getTasks();
  for (const t of tasks.values()) t.stop();
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
      // Verify footer in production
      assert.equal(data.footer?.text, "Topic: anime | Score: 75");
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
      assert.equal(data.footer?.text, "Topic: movies | Score: 90 (Dev Mode)");
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

  await t.test("should prefix the embed title with author name in brackets if author is present", () => {
    const event: NormalizedEvent = {
      id: "author-test",
      type: "news.article",
      topic: "ai",
      title: "AI Story",
      url: "https://example.com/ai/story",
      sourceName: "AI Source",
      author: "Jane Doe",
    };

    const embed = formatArticleEmbed({ event, score: 80 });
    const data = embed.toJSON();

    assert.equal(data.title, "[Jane Doe] AI Story");
  });

  await t.test("should format title with both emoji and author if both are present", () => {
    const event: NormalizedEvent = {
      id: "author-emoji-test",
      type: "news.article",
      topic: "ai",
      title: "AI Story",
      url: "https://example.com/ai/story",
      sourceName: "AI Source",
      author: "Jane Doe",
    };

    const embed = formatArticleEmbed({ event, score: 80, emoji: "<:ai:12345>" });
    const data = embed.toJSON();

    assert.equal(data.title, "<:ai:12345> [Jane Doe] AI Story");
  });

  await t.test("should not prepend author to title if the source comes from Reddit (via sourceName or url)", () => {
    // Case 1: sourceName contains 'Reddit'
    const event1: NormalizedEvent = {
      id: "test-id-reddit-1",
      type: "news.article",
      topic: "ai",
      title: "Reddit Thread Title 1",
      url: "https://example.com/r/ai/story",
      sourceName: "TorontoCraftBeer on Reddit",
      author: "u/beer_lover",
    };
    const embed1 = formatArticleEmbed({ event: event1, score: 80, emoji: "<:ai:12345>" });
    assert.equal(embed1.toJSON().title, "<:ai:12345> Reddit Thread Title 1");

    // Case 2: URL contains 'reddit.com'
    const event2: NormalizedEvent = {
      id: "test-id-reddit-2",
      type: "news.article",
      topic: "ai",
      title: "Reddit Thread Title 2",
      url: "https://www.reddit.com/r/ai/story",
      sourceName: "Custom Feed",
      author: "u/ai_expert",
    };
    const embed2 = formatArticleEmbed({ event: event2, score: 80, emoji: "<:ai:12345>" });
    assert.equal(embed2.toJSON().title, "<:ai:12345> Reddit Thread Title 2");
  });
});

test("RSS Item Normalization and Author Extraction", async (t) => {
  const source = {
    name: "Test Source",
    url: "https://example.com/rss",
    trusted: true,
  };

  await t.test("should extract author from creator field", () => {
    const item = {
      title: "Test Article",
      link: "https://example.com/art1",
      raw: { creator: "Alice Smith" },
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.author, "Alice Smith");
  });

  await t.test("should extract author from author field", () => {
    const item = {
      title: "Test Article",
      link: "https://example.com/art1",
      raw: { author: "Bob Jones" },
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.author, "Bob Jones");
  });

  await t.test("should extract author from dc:creator field", () => {
    const item = {
      title: "Test Article",
      link: "https://example.com/art1",
      raw: { "dc:creator": "Charlie Brown" },
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.author, "Charlie Brown");
  });

  await t.test("should parse author from title and clean it from the title text", () => {
    const item = {
      title: "Bontemps: Why Joel Embiid's MVP run is legendary",
      link: "https://example.com/art1",
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.author, "Bontemps");
    assert.equal(event.title, "Why Joel Embiid's MVP run is legendary");
  });

  await t.test("should parse author with 'By' prefix and clean it from the title text", () => {
    const item = {
      title: "By Tim Bontemps: Joel Embiid's run",
      link: "https://example.com/art1",
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.author, "Tim Bontemps");
    assert.equal(event.title, "Joel Embiid's run");
  });

  await t.test("should NOT parse author if prefix is blacklisted or lowercase", () => {
    const testTitles = [
      "Raptors: Barnes makes progress",
      "breaking: Something happened",
      "ESPN NBA: Mock draft update",
      "Trade Deadline: Players to watch",
    ];

    for (const title of testTitles) {
      const item = { title, link: "https://example.com/art1" };
      const event = normalizeRssItem({ topic: "test", source, item });
      assert.equal(event.author, undefined);
      assert.equal(event.title, title); // Unchanged
    }
  });

  await t.test("should clear generic metadata authors that match the source/publisher name", () => {
    const espnSource = { name: "ESPN NBA", url: "https://example.com/espn", trusted: true };
    const item = {
      title: "Bontemps: Why Joel Embiid's MVP run is legendary",
      link: "https://example.com/art1",
      raw: { creator: "ESPN" }, // generic author matching clean source name "ESPN"
    };
    const event = normalizeRssItem({ topic: "test", source: espnSource, item });
    // Should clear the generic author and fallback to parsing the author from the title
    assert.equal(event.author, "Bontemps");
    assert.equal(event.title, "Why Joel Embiid's MVP run is legendary");
  });

  await t.test("should return undefined for author and not fallback to website name if no author is found", () => {
    const testSource = { name: "Sportsnet Blue Jays", url: "https://example.com/sn", trusted: true };
    const item = {
      title: "No Author Prefix In This Title",
      link: "https://example.com/art1",
    };
    const event = normalizeRssItem({ topic: "test", source: testSource, item });
    assert.equal(event.author, undefined);
    assert.equal(event.title, "No Author Prefix In This Title");
  });

  await t.test("should extract image URL from enclosure metadata", () => {
    const item = {
      title: "Test Enclosure",
      link: "https://example.com/art1",
      raw: {
        enclosure: { url: "https://example.com/image.jpg", type: "image/jpeg" }
      }
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.imageUrl, "https://example.com/image.jpg");
  });

  await t.test("should extract image URL from enclosures array", () => {
    const item = {
      title: "Test Enclosures",
      link: "https://example.com/art1",
      raw: {
        enclosures: [
          { url: "https://example.com/not-image.pdf", type: "application/pdf" },
          { url: "https://example.com/image2.png", type: "image/png" }
        ]
      }
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.imageUrl, "https://example.com/image2.png");
  });

  await t.test("should extract image URL from media:content metadata", () => {
    const item = {
      title: "Test Media RSS",
      link: "https://example.com/art1",
      raw: {
        "media:content": { url: "https://example.com/media-image.webp" }
      }
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.imageUrl, "https://example.com/media-image.webp");
  });

  await t.test("should extract image URL from HTML content (like Reddit/blogs)", () => {
    const item = {
      title: "Test Reddit Post",
      link: "https://example.com/art1",
      raw: {
        description: `
          <table>
            <tr>
              <td>
                <a href="https://example.com/reddit"><img src="https://b.thumbs.redditmedia.com/xyz.jpg" alt="thumbnail" /></a>
              </td>
            </tr>
          </table>
        `
      }
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.imageUrl, "https://b.thumbs.redditmedia.com/xyz.jpg");
  });

  await t.test("should ignore tracking pixel images in HTML", () => {
    const item = {
      title: "Test Tracking Pixel",
      link: "https://example.com/art1",
      raw: {
        description: `
          <div>
            <img src="https://example.com/1x1.png" width="1" height="1" />
            <img src="https://example.com/real-image.jpg" />
          </div>
        `
      }
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.imageUrl, "https://example.com/real-image.jpg");
  });

  await t.test("should decode HTML entities in extracted image URLs", () => {
    const item = {
      title: "Test HTML Entity Image URL",
      link: "https://example.com/art1",
      raw: {
        description: `<img src="https://preview.redd.it/xyz.jpg?width=140&amp;height=78&amp;auto=webp" />`
      }
    };
    const event = normalizeRssItem({ topic: "test", source, item });
    assert.equal(event.imageUrl, "https://preview.redd.it/xyz.jpg?width=140&height=78&auto=webp");
  });

  await t.test("should rewrite unresolvable publish.bluejaysnation.com image URLs using the public Next.js proxy", () => {
    const item = {
      title: "Test Blue Jays Nation Image",
      link: "https://bluejaysnation.com/news/test-article",
      raw: {
        enclosure: {
          url: "https://publish.bluejaysnation.com/wp-content/uploads/sites/8/2026/05/USATSI_lowres.jpg",
          type: "image/jpeg"
        }
      }
    };
    const event = normalizeRssItem({ topic: "jays", source: { name: "Blue Jays Nation", url: "https://bluejaysnation.com/feed/", trusted: true }, item });
    assert.equal(
      event.imageUrl,
      "https://bluejaysnation.com/_next/image?url=https%3A%2F%2Fpublish.bluejaysnation.com%2Fwp-content%2Fuploads%2Fsites%2F8%2F2026%2F05%2FUSATSI_lowres.jpg&w=1200&q=75"
    );

    // Test generalized host matching for another Nation Network site
    const leafItem = {
      title: "Test Leafs Nation Image",
      link: "https://leafsnation.com/news/test-article",
      raw: {
        enclosure: {
          url: "https://publish.leafsnation.com/wp-content/uploads/sites/12/2026/05/player.jpg",
          type: "image/jpeg"
        }
      }
    };
    const leafEvent = normalizeRssItem({ topic: "leafs", source: { name: "Leafs Nation", url: "https://leafsnation.com/feed/", trusted: true }, item: leafItem });
    assert.equal(
      leafEvent.imageUrl,
      "https://leafsnation.com/_next/image?url=https%3A%2F%2Fpublish.leafsnation.com%2Fwp-content%2Fuploads%2Fsites%2F12%2F2026%2F05%2Fplayer.jpg&w=1200&q=75"
    );
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

  await t.test("should set image from event.imageUrl on the formatArticleEmbed result", () => {
    const event: NormalizedEvent = {
      id: "test-id-img",
      type: "news.article",
      topic: "anime",
      title: "Image Title",
      url: "https://example.com/test-img",
      sourceName: "Test Source",
      imageUrl: "https://example.com/embed-image.png"
    };
    const embed = formatArticleEmbed({ event, score: 80 });
    assert.equal(embed.data.image?.url, "https://example.com/embed-image.png");
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
    assert.equal(payloads.length, 19);
    assert.equal(payloads[0].name, "ping");
    assert.equal(payloads[1].name, "testfeed");
    assert.equal(payloads[2].name, "lastposts");
    assert.equal(payloads[3].name, "reload-config");
    assert.equal(payloads[4].name, "testdigest");
    assert.equal(payloads[5].name, "refresh");
    assert.equal(payloads[6].name, "stats");
    assert.equal(payloads[7].name, "search");
    assert.equal(payloads[8].name, "topics");
    assert.equal(payloads[9].name, "sources");
    assert.equal(payloads[10].name, "favorites");
    assert.equal(payloads[11].name, "unfavorite");
    assert.equal(payloads[12].name, "audit");
    assert.equal(payloads[13].name, "topic");
    assert.equal(payloads[14].name, "source");
    assert.equal(payloads[15].name, "keyword");
    assert.equal(payloads[16].name, "Remove Article");
    assert.equal(payloads[17].name, "Merge to Thread");
    assert.equal(payloads[18].name, "Remove from Thread");
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

      await handleReloadconfigCommand(mockInteraction, {} as any, mockConfig);
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

  await t.test("handleTestdigestCommand should execute test digest", async () => {
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
            if (name === "intent") return "aggregate";
            return null;
          },
          getBoolean: (name: string) => {
            if (name === "post") return false;
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

      await handleTestdigestCommand(mockInteraction, mockClient, mockConfig);
      assert.ok(deferred);
      assert.ok(editedReply);
      assert.match(replyContent, /Digest execution complete/);
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
        anime: {
          channelId: "12345",
          keywords: ["magic", "goku"],
          blockedTerms: ["boring"],
          postThreshold: 70,
          emoji: "<:anime:9876>",
          intentRouting: {
            discussion: { route: "digest_pending", digestSchedule: "0 21 * * *" }
          }
        }
      },
      sources: {
        anime: [
          { name: "Crunchyroll", url: "https://example.com/anime", trusted: true, intentDefault: "news" },
          { name: "Reddit Anime", url: "https://reddit.com/r/anime/.rss", trusted: false, intentDefault: "discussion" }
        ]
      }
    };

    await handleTopicsCommand(mockInteraction, mockConfig);
    assert.ok(replied);
    assert.match(replyContent, /Configured News Topics/);
    assert.match(replyContent, /Emoji: <:anime:9876>/);
    assert.match(replyContent, /Threshold: `70`/);
    assert.match(replyContent, /Sources \(2\) by intent: `discussion`: 1, `news`: 1/);
    assert.match(replyContent, /Intent routing: `discussion` -> route: `digest_pending`, schedule: `0 21 \* \* \*`/);
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
      topics: {
        anime: {
          channelId: "123",
          keywords: [],
          blockedTerms: [],
          postThreshold: 0,
          intentRouting: {
            aggregate: { route: "digest_pending", digestEligible: true, postThreshold: 50 }
          }
        }
      },
      sources: {
        anime: [
          { name: "Feed 1", url: "https://example.com/feed1", trusted: true, intentDefault: "official", routeHint: "immediate_post", tier: 1 },
          { name: "Feed 2", url: "https://example.com/feed2", trusted: false, intentDefault: "discussion" }
        ]
      }
    };

    await handleSourcesCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.match(replyContent, /Feed 1.*https:\/\/example.com\/feed1/);
    assert.match(replyContent, /Feed 2.*https:\/\/example.com\/feed2/);
    assert.match(replyContent, /Intent defaults: `discussion`: 1, `official`: 1/);
    assert.match(replyContent, /Intent routing: `aggregate` -> route: `digest_pending`, threshold: `50`, digest: `yes`/);
    assert.match(replyContent, /Feed 1.*trusted, intent: `official`, route hint: `immediate_post`, tier: `1`/);
  });

  await t.test("handleSourcesCommand should chunk long source lists", async () => {
    let deferred = false;
    let editedReply = false;
    let replyContent = "";
    const followedUp: string[] = [];

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
      },
      followUp: async (options: any) => {
        followedUp.push(typeof options === "string" ? options : options.content);
      }
    };

    const feeds = [];
    for (let i = 0; i < 40; i++) {
      feeds.push({
        name: `Feed Long Name ${i}`,
        url: `https://example.com/feed-very-long-url-path-to-test-chunking-behavior-${i}`,
        trusted: i % 2 === 0
      });
    }

    const mockConfig: AppConfig = {
      topics: { anime: { channelId: "123", keywords: [], blockedTerms: [], postThreshold: 0 } },
      sources: { anime: feeds }
    };

    await handleSourcesCommand(mockInteraction, mockConfig);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.ok(followedUp.length > 0, "Should have called followUp for second chunk");
    assert.match(replyContent, /Feed Long Name 0/);
    assert.match(followedUp[followedUp.length - 1], /Feed Long Name 39/);
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

test("Google News URL Resolver & OG Image Scraper", async (t) => {
  const originalFetch = globalThis.fetch;
  
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("decodeGoogleNewsUrl should pass through non-Google News URLs", async () => {
    const url = "https://example.com/some-article";
    const res = await decodeGoogleNewsUrl(url);
    assert.equal(res, url);
  });

  await t.test("decodeGoogleNewsUrl should resolve new style AU_yqL URLs via batchexecute", async () => {
    const googleNewsUrl = "https://news.google.com/rss/articles/CBMinwFBVV95cUxQNkhhV213dkV4enA3T3k5cXdwY0pPWjlnd3pnUkpmRnhWLVk3dHIzcm5KQ3hJcFVFZUU3aEdXUTNQVUE4QTV4UnNDV3FlU1k2S3ZtY245OGk3R1prUGNtallWOFVyaTR2TzBveV9xanFhZFNIWlg5blhzSzdxb0pOZTJqeWg2N3NLdF9YbVJ4UlhLaUJwLUpUZEs3VDhVVG8?oc=5";
    
    globalThis.fetch = async (input: any, init: any) => {
      const urlStr = input.toString();
      if (urlStr.includes("news.google.com/rss/articles/")) {
        return {
          ok: true,
          status: 200,
          text: async () => `<html><body><c-wiz data-n-a-sg="AaLI4RRMj5_ixIzz3ywNB382mwPg" data-n-a-ts="1780003489"></c-wiz></body></html>`
        } as any;
      }
      if (urlStr.includes("batchexecute")) {
        return {
          ok: true,
          status: 200,
          text: async () => '\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://resolved-link.com\\",\\"another-link\\"]",null,null,null,null,"generic"]]'
        } as any;
      }
      return { ok: false, status: 404 } as any;
    };

    const res = await decodeGoogleNewsUrl(googleNewsUrl);
    assert.equal(res, "https://resolved-link.com");
  });

  await t.test("scrapeOgImage should extract og:image tag", async () => {
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <html>
            <head>
              <meta property="og:image" content="https://example.com/og.jpg" />
            </head>
          </html>
        `
      } as any;
    };

    const img = await scrapeOgImage("https://example.com/article");
    assert.equal(img, "https://example.com/og.jpg");
  });

  await t.test("scrapeOgImage should fallback to twitter:image tag", async () => {
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <html>
            <head>
              <meta name="twitter:image" content="https://example.com/twitter.jpg" />
            </head>
          </html>
        `
      } as any;
    };

    const img = await scrapeOgImage("https://example.com/article");
    assert.equal(img, "https://example.com/twitter.jpg");
  });

  await t.test("scrapeOgImage should decode HTML entities in extracted URLs", async () => {
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <html>
            <head>
              <meta property="og:image" content="https://example.com/og.jpg?width=100&amp;height=200" />
            </head>
          </html>
        `
      } as any;
    };

    const img = await scrapeOgImage("https://example.com/article");
    assert.equal(img, "https://example.com/og.jpg?width=100&height=200");
  });

  await t.test("scrapeOgImage should return undefined on error", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network error");
    };

    const img = await scrapeOgImage("https://example.com/article");
    assert.equal(img, undefined);
  });
});
