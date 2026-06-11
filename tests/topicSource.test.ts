import { copyFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import {
  handleTopicCommand,
  handleSourceCommand
} from "../src/bot/commands.js";
import { type AppConfig, reloadAppConfig } from "../src/config/loadConfig.js";
import { pollNews } from "../src/jobs/pollNews.js";

// Backup and restore helper
const TOPICS_PATH = "src/config/topics.json";
const SOURCES_PATH = "src/config/sources.json";
const TOPICS_BAK = "src/config/topics.json.bak";
const SOURCES_BAK = "src/config/sources.json.bak";

before(async () => {
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
      blockedTerms: [],
      postThreshold: 50,
      disabled: true
    }
  };

  const testSources = {
    anime: [
      { name: "Crunchyroll", url: "https://crunchyroll.com/news.rss", trusted: true }
    ],
    tech: []
  };

  await writeFile(TOPICS_PATH, JSON.stringify(testTopics, null, 2), "utf8");
  await writeFile(SOURCES_PATH, JSON.stringify(testSources, null, 2), "utf8");
});

after(async () => {
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

// Mock builder helper
function createMockInteraction(options: {
  userId?: string;
  subcommand: string;
  optionsMap: Record<string, any>;
  onReply?: (payload: any) => Promise<any> | void;
  onEditReply?: (payload: any) => Promise<any> | void;
  onDeferReply?: (payload: any) => Promise<any> | void;
  onFollowUp?: (payload: any) => Promise<any> | void;
}): any {
  return {
    user: { id: options.userId ?? "9999" },
    member: { roles: { cache: new Map() } },
    options: {
      getSubcommand: () => options.subcommand,
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
    },
    followUp: async (payload: any) => {
      if (options.onFollowUp) return options.onFollowUp(payload);
      return {};
    }
  };
}

test("Topic Management Command Suite", async (t) => {
  // Base configuration to mutation-test
  let appConfig: AppConfig;

  before(async () => {
    // Load config from the test initial state written above
    const loaded = {
      topics: {
        anime: { channelId: "11111111", keywords: ["naruto"], blockedTerms: [], postThreshold: 20, emoji: "📺" },
        tech: { channelId: "22222222", keywords: [], blockedTerms: [], postThreshold: 50, disabled: true }
      },
      sources: {
        anime: [{ name: "Crunchyroll", url: "https://crunchyroll.com/news.rss", trusted: true }],
        tech: []
      }
    };
    appConfig = loaded;
  });

  await t.test("should deny access to non-managers", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "12345"; // restricts to 12345

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999", // non-manager
        subcommand: "list",
        optionsMap: {},
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /do not have permission/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should list all topics, highlighting disabled ones", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "list",
        optionsMap: {},
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /anime.*🟢 \[ACTIVE\]/);
      assert.match(replyContent, /tech.*🔴 \[DISABLED\]/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should view details of specific topic config", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "view",
        optionsMap: { topic: "anime" },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /Topic Lane: \*\*anime\*\*/);
      assert.match(replyContent, /Sources \(1\) by Intent:\*\* `auto`: 1/);
      assert.match(replyContent, /Intent Routing:\*\* \*Default routing\*/);
      assert.match(replyContent, /Crunchyroll/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("view rejects unknown topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "view",
        optionsMap: { topic: "unknown-lane" },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /Unknown topic/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should reject invalid topic name on creation", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "create",
        optionsMap: {
          name: "Invalid Topic Name!",
          channel: { id: "123" }
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /Invalid topic name/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should reject duplicate topic name", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "create",
        optionsMap: {
          name: "anime",
          channel: { id: "123" }
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /already exists/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should reject invalid emoji format", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "create",
        optionsMap: {
          name: "gaming",
          channel: { id: "123" },
          emoji: "invalid custom emoji string here"
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /Invalid emoji format/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should create a valid topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "create",
        optionsMap: {
          name: "sports",
          channel: { id: "33333333" },
          threshold: 30,
          emoji: "🏀"
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully created topic lane/);

      // Verify in-memory reload
      assert.ok(appConfig.topics.sports);
      assert.equal(appConfig.topics.sports.channelId, "33333333");
      assert.equal(appConfig.topics.sports.postThreshold, 30);
      assert.equal(appConfig.topics.sports.emoji, "🏀");
      assert.ok(Array.isArray(appConfig.sources.sports));
      assert.equal(appConfig.sources.sports.length, 0);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should update posting channel for a topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "set-channel",
        optionsMap: {
          topic: "sports",
          channel: { id: "44444444" }
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully updated channel/);

      // Verify in-memory reload
      assert.equal(appConfig.topics.sports.channelId, "44444444");
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should update threshold for a topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "set-threshold",
        optionsMap: {
          topic: "sports",
          threshold: -10
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully updated post threshold/);

      // Verify in-memory reload
      assert.equal(appConfig.topics.sports.postThreshold, -10);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should update/clear emoji prefix for a topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      // 1. Set new emoji
      let interaction = createMockInteraction({
        userId: "9999",
        subcommand: "set-emoji",
        optionsMap: {
          topic: "sports",
          emoji: "⚽"
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully updated emoji prefix/);
      assert.equal(appConfig.topics.sports.emoji, "⚽");

      // 2. Clear emoji
      interaction = createMockInteraction({
        userId: "9999",
        subcommand: "set-emoji",
        optionsMap: {
          topic: "sports",
          emoji: "clear"
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.equal(appConfig.topics.sports.emoji, undefined);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should disable and re-enable a topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      // Disable
      let interaction = createMockInteraction({
        userId: "9999",
        subcommand: "disable",
        optionsMap: {
          topic: "sports"
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /disabled/);
      assert.equal(appConfig.topics.sports.disabled, true);

      // Re-enable (toggle back)
      interaction = createMockInteraction({
        userId: "9999",
        subcommand: "disable",
        optionsMap: {
          topic: "sports"
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleTopicCommand(interaction, appConfig);
      assert.equal(appConfig.topics.sports.disabled, false);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });
});

test("Source Management Command Suite", async (t) => {
  let appConfig: AppConfig;

  before(async () => {
    const loaded = {
      topics: {
        anime: { channelId: "11111111", keywords: ["naruto"], blockedTerms: [], postThreshold: 20, emoji: "📺" },
        tech: { channelId: "22222222", keywords: [], blockedTerms: [], postThreshold: 50, disabled: true }
      },
      sources: {
        anime: [{ name: "Crunchyroll", url: "https://crunchyroll.com/news.rss", trusted: true }],
        tech: []
      }
    };
    appConfig = loaded;
  });

  await t.test("should list sources for a topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "list",
        optionsMap: { topic: "anime" },
        onDeferReply: () => {
          deferred = true;
        },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleSourceCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Crunchyroll/);
      assert.match(editContent, /TRUSTED/);
      assert.match(editContent, /Intent defaults: `auto`: 1/);
      assert.match(editContent, /intent: `auto`/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should chunk long source lists for a topic", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      const longConfig: AppConfig = {
        topics: {
          "toronto-eats": { channelId: "33333333", keywords: [], blockedTerms: [], postThreshold: 20 }
        },
        sources: {
          "toronto-eats": Array.from({ length: 35 }, (_, index) => ({
            name: `Toronto Source ${index + 1}`,
            url: `https://example.com/very/long/rss/feed/path/${index + 1}?neighbourhood=toronto&category=restaurants`,
            trusted: index % 2 === 0
          }))
        }
      };
      const messages: string[] = [];

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "list",
        optionsMap: { topic: "toronto-eats" },
        onEditReply: (payload) => {
          messages.push(typeof payload === "string" ? payload : payload.content);
        },
        onFollowUp: (payload) => {
          messages.push(typeof payload === "string" ? payload : payload.content);
        }
      });

      await handleSourceCommand(interaction, longConfig);
      assert.ok(messages.length > 1);
      assert.ok(messages.every(message => message.length <= 2000));
      assert.match(messages.join("\n"), /Toronto Source 35/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should reject adding duplicate source name", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "add",
        optionsMap: {
          topic: "anime",
          name: "Crunchyroll",
          url: "https://crunchyroll.com/different.rss",
          trusted: false
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleSourceCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /already exists/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should reject adding duplicate source URL", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "add",
        optionsMap: {
          topic: "anime",
          name: "Different Name",
          url: "https://crunchyroll.com/news.rss",
          trusted: false
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleSourceCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /already exists/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should reject invalid URL on add", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let replied = false;
      let replyContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "add",
        optionsMap: {
          topic: "anime",
          name: "Another Feed",
          url: "this is not a valid url string",
          trusted: false
        },
        onReply: (payload) => {
          replied = true;
          replyContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleSourceCommand(interaction, appConfig);
      assert.ok(replied);
      assert.match(replyContent, /Invalid URL format/);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should add a valid source", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "add",
        optionsMap: {
          topic: "anime",
          name: "Funimation",
          url: "https://funimation.com/news.rss",
          trusted: false
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleSourceCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully added/);

      // Verify in-memory reload
      assert.equal(appConfig.sources.anime.length, 2);
      assert.equal(appConfig.sources.anime[1].name, "Funimation");
      assert.equal(appConfig.sources.anime[1].url, "https://funimation.com/news.rss");
      assert.equal(appConfig.sources.anime[1].trusted, false);
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });

  await t.test("should remove a source", async () => {
    const originalEnv = process.env.BOT_MANAGER_USER_IDS;
    process.env.BOT_MANAGER_USER_IDS = "9999";

    try {
      let deferred = false;
      let edited = false;
      let editContent = "";

      const interaction = createMockInteraction({
        userId: "9999",
        subcommand: "remove",
        optionsMap: {
          topic: "anime",
          name: "Funimation"
        },
        onDeferReply: () => { deferred = true; },
        onEditReply: (payload) => {
          edited = true;
          editContent = typeof payload === "string" ? payload : payload.content;
        }
      });

      await handleSourceCommand(interaction, appConfig);
      assert.ok(deferred);
      assert.ok(edited);
      assert.match(editContent, /Successfully removed/);

      // Verify in-memory reload
      assert.equal(appConfig.sources.anime.length, 1);
      assert.equal(appConfig.sources.anime[0].name, "Crunchyroll");
    } finally {
      process.env.BOT_MANAGER_USER_IDS = originalEnv;
    }
  });
});

test("Polling Lane Skipped Check", async (t) => {
  await t.test("pollNews should skip check for disabled topics", async () => {
    const mockConfig: AppConfig = {
      topics: {
        activeTopic: { channelId: "activeCh", keywords: [], blockedTerms: [], postThreshold: 10 },
        disabledTopic: { channelId: "disabledCh", keywords: [], blockedTerms: [], postThreshold: 10, disabled: true }
      },
      sources: {
        activeTopic: [{ name: "Active", url: "https://example.com/rss", trusted: true }],
        disabledTopic: [{ name: "Disabled", url: "https://example.com/rss", trusted: true }]
      }
    };

    // We can run pollNews and check returned counts.
    // We pass a dummy client. Since pollNews calls fetchFeedItems which tries to hit URL,
    // let's pass a mock client that will throw or fetch but wait - let's see.
    // If the topic is disabled, it will return early (continue) BEFORE it fetches feeds.
    // If it is active, it will try to fetch feeds and fail/throw (since feed isn't mocked),
    // which adds to errors or count checked.
    // Let's verify that 'disabledTopic' has no entries or counts in the result, or that it is ignored.
    const client: any = {};
    const errors: any[] = [];
    
    const counts = await pollNews(client, mockConfig, errors);
    
    // Check that counts has disabledTopic but counts are zero or it has activeTopic.
    // Wait, let's verify pollNews returns count structure.
    assert.ok(counts.activeTopic);
    assert.ok(counts.disabledTopic);
    // Since disabledTopic skips early, all its values (checked, newItems, skipped, posted) must be 0!
    assert.equal(counts.disabledTopic.checked, 0);
    assert.equal(counts.disabledTopic.newItems, 0);
    assert.equal(counts.disabledTopic.skipped, 0);
    assert.equal(counts.disabledTopic.posted, 0);
  });
});
