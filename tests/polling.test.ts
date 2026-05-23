import { execSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { Client } from "discord.js";

// 1. Force the test database URL before importing prisma or repository modules
const TEST_DB_URL = "file:./dev-test-poll.db";
const TEST_DB_FILE = "./prisma/dev-test-poll.db";
process.env.DATABASE_URL = TEST_DB_URL;

// Import after setting env
import { prisma } from "../src/storage/prismaClient.js";
import { pollNews } from "../src/jobs/pollNews.js";
import type { AppConfig } from "../src/config/loadConfig.js";

// Force color-free output for accessibility
process.env.NO_COLOR = "1";
process.env.FORCE_COLOR = "0";

const originalFetch = globalThis.fetch;

before(async () => {
  console.log("Setting up isolated polling test database...");
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
  console.log("Cleaning up polling test database...");
  await prisma.$disconnect();
  cleanUpTestFiles();
  globalThis.fetch = originalFetch;
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-poll.db",
    "./prisma/dev-test-poll.db-journal",
    "./dev-test-poll.db",
    "./dev-test-poll.db-journal",
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

// Helper to create simple RSS XML mock
function createRssXml(title: string, link: string, guid: string, desc: string): string {
  return `
<rss version="2.0">
  <channel>
    <title>Mock Feed</title>
    <link>https://example.com</link>
    <description>Mock Description</description>
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid>${guid}</guid>
      <pubDate>Sat, 23 May 2026 12:00:00 GMT</pubDate>
      <description>${desc}</description>
    </item>
  </channel>
</rss>
  `;
}

test("Scheduled Polling Pipeline System", async (t) => {
  // A mock Discord client that captures posted embeds
  const postedEmbeds: Array<{ channelId: string; embed: any }> = [];
  const mockClient = {
    channels: {
      fetch: async (channelId: string) => {
        return {
          isTextBased: () => true,
          send: async (payload: { embeds: any[] }) => {
            postedEmbeds.push({ channelId, embed: payload.embeds[0] });
            return { id: "mock-message-id" };
          },
        };
      },
    },
  } as unknown as Client;

  await t.test("should process, score, filter, post, and save an eligible article", async () => {
    postedEmbeds.length = 0;
    await prisma.article.deleteMany({});
    delete process.env.DRY_RUN;

    // Mock fetch for a valid RSS feed
    const xml = createRssXml(
      "Breaking News: Ultimate AI Release!",
      "https://example.com/ai/breaking",
      "guid-ai-1",
      "A breakthrough AI agent has been released today."
    );

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        text: async () => xml,
      } as Response;
    };

    const config: AppConfig = {
      topics: {
        ai: {
          channelId: "123456789",
          postThreshold: 10,
          keywords: ["AI", "breakthrough"],
          blockedTerms: ["spam"],
        },
      },
      sources: {
        ai: [
          {
            name: "AI Blog",
            url: "https://example.com/ai/rss",
            trusted: false,
          },
        ],
      },
    };

    const counts = await pollNews(mockClient, config);
    
    // Assert counts
    assert.deepEqual(counts.ai, {
      checked: 1,
      newItems: 1,
      skipped: 0,
      posted: 1,
    });

    // Assert Discord posting
    assert.equal(postedEmbeds.length, 1);
    assert.equal(postedEmbeds[0].channelId, "123456789");
    assert.equal(postedEmbeds[0].embed.data.title, "Breaking News: Ultimate AI Release!");

    // Assert database save
    const saved = await prisma.article.findUnique({ where: { id: "guid-ai-1" } });
    assert.ok(saved);
    assert.equal(saved.title, "Breaking News: Ultimate AI Release!");
    assert.ok(saved.score >= 10);
    assert.ok(saved.postedAt !== null);
  });

  await t.test("should skip duplicate articles on subsequent runs", async () => {
    postedEmbeds.length = 0;
    await prisma.article.deleteMany({});
    delete process.env.DRY_RUN;

    const xml = createRssXml(
      "Same Duplicate Article",
      "https://example.com/duplicate",
      "guid-dup-1",
      "This is a duplicate"
    );

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        text: async () => xml,
      } as Response;
    };

    const config: AppConfig = {
      topics: {
        ai: {
          channelId: "123456789",
          postThreshold: 0,
          keywords: [],
          blockedTerms: [],
        },
      },
      sources: {
        ai: [
          {
            name: "AI Blog",
            url: "https://example.com/ai/rss",
            trusted: false,
          },
        ],
      },
    };

    // First run - saves and posts
    const counts1 = await pollNews(mockClient, config);
    assert.equal(counts1.ai.posted, 1);
    assert.equal(postedEmbeds.length, 1);

    // Second run - skips as duplicate
    const counts2 = await pollNews(mockClient, config);
    assert.equal(counts2.ai.checked, 1);
    assert.equal(counts2.ai.newItems, 0);
    assert.equal(counts2.ai.skipped, 1);
    assert.equal(counts2.ai.posted, 0);
    assert.equal(postedEmbeds.length, 1); // No new embeds posted
  });

  await t.test("should handle feed fetch failures gracefully per source", async () => {
    postedEmbeds.length = 0;
    await prisma.article.deleteMany({});
    delete process.env.DRY_RUN;

    // Source 1 fails, Source 2 succeeds
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : (url as any).url || String(url);
      if (urlStr.includes("fail")) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error",
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => createRssXml("Source 2 Story", "https://example.com/s2", "guid-s2", "Success"),
      } as Response;
    };

    const config: AppConfig = {
      topics: {
        mixed: {
          channelId: "999",
          postThreshold: 0,
          keywords: [],
          blockedTerms: [],
        },
      },
      sources: {
        mixed: [
          { name: "Failing Source", url: "https://example.com/fail", trusted: false },
          { name: "Succeeding Source", url: "https://example.com/ok", trusted: false },
        ],
      },
    };

    const errors: any[] = [];
    const counts = await pollNews(mockClient, config, errors);

    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("(500)"));
    assert.equal(errors[0].source, "Failing Source");

    assert.equal(counts.mixed.posted, 1);
    assert.equal(postedEmbeds.length, 1);
    assert.equal(postedEmbeds[0].embed.data.title, "Source 2 Story");
  });

  await t.test("should honor DRY_RUN env variable", async () => {
    postedEmbeds.length = 0;
    await prisma.article.deleteMany({});
    process.env.DRY_RUN = "true";

    const xml = createRssXml("Dry Run Article", "https://example.com/dry", "guid-dry", "Dry run");
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        text: async () => xml,
      } as Response;
    };

    const config: AppConfig = {
      topics: {
        ai: {
          channelId: "123456789",
          postThreshold: 0,
          keywords: [],
          blockedTerms: [],
        },
      },
      sources: {
        ai: [
          { name: "AI Blog", url: "https://example.com/ai/rss", trusted: false },
        ],
      },
    };

    const counts = await pollNews(mockClient, config);

    assert.equal(counts.ai.posted, 0);
    assert.equal(counts.ai.skipped, 1);
    assert.equal(postedEmbeds.length, 0);

    // Verify it is NOT saved in the database
    const saved = await prisma.article.findUnique({ where: { id: "guid-dry" } });
    assert.equal(saved, null);
  });
});
