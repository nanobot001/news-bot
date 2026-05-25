import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

const TEST_DB_URL = "file:./dev-test-fav.db";
const TEST_DB_FILE = "./prisma/dev-test-fav.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle, saveFavorite, getFavorites, getArticleByMessageId, deleteFavorite, deleteFavoriteById } from "../src/storage/articleRepo.js";
import { handleReactionAdd, handleReactionRemove } from "../src/bot/reactionListener.js";
import { saveToInstapaper } from "../src/integration/instapaper.js";
import { handleUnfavoriteCommand } from "../src/bot/commands.js";

before(async () => {
  console.log("Setting up isolated favorites test database...");
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
  console.log("Cleaning up favorites test database...");
  await prisma.$disconnect();
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-fav.db",
    "./prisma/dev-test-fav.db-journal",
    "./dev-test-fav.db",
    "./dev-test-fav.db-journal",
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

test("Instapaper Save logic", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  await t.test("should skip Instapaper sync if credentials are not configured", async () => {
    delete process.env.INSTAPAPER_USERNAME;
    delete process.env.INSTAPAPER_PASSWORD;
    const res = await saveToInstapaper("https://example.com");
    assert.equal(res, "SKIPPED");
  });

  await t.test("should succeed on 201/200 response from Instapaper Simple API", async () => {
    process.env.INSTAPAPER_USERNAME = "test";
    process.env.INSTAPAPER_PASSWORD = "pwd";

    let fetchedUrl = "";
    let fetchedBody = "";

    globalThis.fetch = async (url: any, options: any) => {
      fetchedUrl = url.toString();
      fetchedBody = options.body;
      return {
        ok: true,
        status: 201,
        text: async () => "OK"
      } as any;
    };

    const res = await saveToInstapaper("https://example.com/test-article");
    assert.equal(res, "SUCCESS");
    assert.equal(fetchedUrl, "https://www.instapaper.com/api/add");
    assert.ok(fetchedBody.includes("url=https%3A%2F%2Fexample.com%2Ftest-article"));
  });

  await t.test("should return FAILED on Instapaper HTTP error", async () => {
    process.env.INSTAPAPER_USERNAME = "test";
    process.env.INSTAPAPER_PASSWORD = "pwd";

    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 403,
        text: async () => "Invalid username or password"
      } as any;
    };

    const res = await saveToInstapaper("https://example.com/fail-article");
    assert.equal(res, "FAILED");
  });
});

test("Database Favorites operations", async (t) => {
  await prisma.userFavorite.deleteMany({});
  await prisma.article.deleteMany({});

  const event1 = {
    id: "art-1",
    type: "news.article",
    topic: "gaming",
    title: "Final Fantasy XVII Announced",
    url: "https://example.com/ff17",
    sourceName: "IGN",
  };

  const event2 = {
    id: "art-2",
    type: "news.article",
    topic: "anime",
    title: "Jujutsu Kaisen Season 3 Details",
    url: "https://example.com/jjk3",
    sourceName: "Crunchyroll",
  };

  await saveArticle(event1, 80, new Date(), "POSTED", undefined, "msg-123", "chan-456");
  await saveArticle(event2, 90, new Date(), "POSTED", undefined, "msg-999", "chan-456");

  await t.test("should link article and read it by message ID", async () => {
    const art = await getArticleByMessageId("msg-123");
    assert.ok(art);
    assert.equal(art.title, "Final Fantasy XVII Announced");
  });

  await t.test("should save a user favorite idempotently", async () => {
    await saveFavorite({
      userId: "user-1",
      articleId: "art-1",
      articleTopic: "gaming",
      channelId: "chan-456",
      messageId: "msg-123",
      instapaperStatus: "SUCCESS"
    });

    // Save duplicate to verify idempotency
    await saveFavorite({
      userId: "user-1",
      articleId: "art-1",
      articleTopic: "gaming",
      channelId: "chan-456",
      messageId: "msg-123",
      instapaperStatus: "SUCCESS"
    });

    const favs = await getFavorites("user-1", {});
    assert.equal(favs.length, 1);
    assert.equal(favs[0].articleId, "art-1");
  });

  await t.test("should apply search query and limit filters", async () => {
    await saveFavorite({
      userId: "user-1",
      articleId: "art-2",
      articleTopic: "anime",
      channelId: "chan-456",
      messageId: "msg-999",
      instapaperStatus: "SKIPPED"
    });

    // Test text search query
    const results = await getFavorites("user-1", { query: "Kaisen" });
    assert.equal(results.length, 1);
    assert.equal(results[0].article.title, "Jujutsu Kaisen Season 3 Details");

    // Test topic filter
    const topicResults = await getFavorites("user-1", { topic: "gaming" });
    assert.equal(topicResults.length, 1);
    assert.equal(topicResults[0].articleTopic, "gaming");

    // Test limit filter
    const limitResults = await getFavorites("user-1", { limit: 1 });
    assert.equal(limitResults.length, 1);
  });

  await t.test("should parse relative since timeframe correctly", async () => {
    const results = await getFavorites("user-1", { since: "1d" });
    assert.equal(results.length, 2);

    const oldResults = await getFavorites("user-1", { since: "2020-01-01" });
    assert.equal(oldResults.length, 2);
  });
});

test("Discord Heart Reaction handling", async (t) => {
  await prisma.userFavorite.deleteMany({});
  await prisma.article.deleteMany({});

  const event = {
    id: "art-react",
    type: "news.article",
    topic: "anime",
    title: "Reaction Test Article",
    url: "https://example.com/react",
    sourceName: "Crunchyroll",
  };
  await saveArticle(event, 85, new Date(), "POSTED", undefined, "msg-react-123", "chan-react");

  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  await t.test("should favorite article on heart reaction", async () => {
    process.env.INSTAPAPER_USERNAME = "test";
    process.env.INSTAPAPER_PASSWORD = "pwd";

    let instapaperCalled = false;
    globalThis.fetch = async () => {
      instapaperCalled = true;
      return { ok: true, status: 201 } as any;
    };

    // Mock reaction and user objects
    const mockReaction: any = {
      partial: false,
      emoji: { name: "❤️" },
      message: {
        partial: false,
        id: "msg-react-123",
        channelId: "chan-react"
      }
    };
    const mockUser: any = {
      bot: false,
      id: "user-react-99",
      username: "ReactTester"
    };

    await handleReactionAdd(mockReaction, mockUser);

    const favs = await getFavorites("user-react-99", {});
    assert.equal(favs.length, 1);
    assert.equal(favs[0].article.title, "Reaction Test Article");
    assert.ok(instapaperCalled);
  });

  await t.test("should ignore reaction if not a heart emoji", async () => {
    const mockReaction: any = {
      partial: false,
      emoji: { name: "👍" },
      message: {
        partial: false,
        id: "msg-react-123",
        channelId: "chan-react"
      }
    };
    const mockUser: any = {
      bot: false,
      id: "user-react-98",
      username: "ThumbTester"
    };

    await handleReactionAdd(mockReaction, mockUser);

    const favs = await getFavorites("user-react-98", {});
    assert.equal(favs.length, 0);
  });
});

test("Deletion and Unfavorite Command", async (t) => {
  // Setup data
  await prisma.userFavorite.deleteMany({});
  await prisma.article.deleteMany({});

  const event = {
    id: "art-del-1",
    type: "news.article",
    topic: "sports",
    title: "Arsenal vs Chelsea",
    url: "https://example.com/sports-match",
    sourceName: "Sky Sports",
  };
  await saveArticle(event, 90, new Date(), "POSTED", undefined, "msg-del-123", "chan-sports");

  // Save the favorite first
  await saveFavorite({
    userId: "user-del-1",
    articleId: "art-del-1",
    articleTopic: "sports",
    channelId: "chan-sports",
    messageId: "msg-del-123",
    instapaperStatus: "SKIPPED"
  });

  await t.test("should delete favorite by reaction removal", async () => {
    const mockReaction: any = {
      partial: false,
      emoji: { name: "❤️" },
      message: {
        partial: false,
        id: "msg-del-123",
        channelId: "chan-sports"
      }
    };
    const mockUser: any = {
      bot: false,
      id: "user-del-1",
      username: "UnheartTester"
    };

    // Verify it exists first
    let favs = await getFavorites("user-del-1", {});
    assert.equal(favs.length, 1);

    await handleReactionRemove(mockReaction, mockUser);

    favs = await getFavorites("user-del-1", {});
    assert.equal(favs.length, 0);
  });

  await t.test("should delete favorite by slash command", async () => {
    // Re-save favorite
    const fav = await saveFavorite({
      userId: "user-del-1",
      articleId: "art-del-1",
      articleTopic: "sports",
      channelId: "chan-sports",
      messageId: "msg-del-123",
      instapaperStatus: "SKIPPED"
    });
    assert.ok(fav);

    let replyMessage = "";
    let deferred = false;
    const mockInteraction: any = {
      user: { id: "user-del-1" },
      options: {
        getString: (name: string) => fav.id // Pass the exact favorite ID
      },
      deferReply: async (opts: any) => {
        deferred = true;
      },
      editReply: async (payload: any) => {
        replyMessage = typeof payload === "string" ? payload : payload.content;
        return {} as any;
      }
    };

    await handleUnfavoriteCommand(mockInteraction, {} as any);

    assert.ok(deferred);
    assert.ok(replyMessage.includes("Successfully removed favorite: \"Arsenal vs Chelsea\""));

    const favs = await getFavorites("user-del-1", {});
    assert.equal(favs.length, 0);
  });

  await t.test("should delete favorite using fallback query matching", async () => {
    // Re-save favorite
    const fav = await saveFavorite({
      userId: "user-del-1",
      articleId: "art-del-1",
      articleTopic: "sports",
      channelId: "chan-sports",
      messageId: "msg-del-123",
      instapaperStatus: "SKIPPED"
    });
    assert.ok(fav);

    let replyMessage = "";
    const mockInteraction: any = {
      user: { id: "user-del-1" },
      options: {
        getString: (name: string) => "Chelsea" // Query fallback keyword
      },
      deferReply: async () => {},
      editReply: async (payload: any) => {
        replyMessage = typeof payload === "string" ? payload : payload.content;
        return {} as any;
      }
    };

    await handleUnfavoriteCommand(mockInteraction, {} as any);

    assert.ok(replyMessage.includes("Successfully removed favorite: \"Arsenal vs Chelsea\""));

    const favs = await getFavorites("user-del-1", {});
    assert.equal(favs.length, 0);
  });
});
