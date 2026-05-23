import assert from "node:assert/strict";
import test from "node:test";
import { formatArticleEmbed, postArticleToChannel } from "../src/bot/postEmbed.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

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
