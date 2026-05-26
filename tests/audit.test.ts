import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

const TEST_DB_URL = "file:./dev-test-audit.db";
const TEST_DB_FILE = "./prisma/dev-test-audit.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { saveCurationLog, getCurationLogs } from "../src/storage/articleRepo.js";
import { isBotManager } from "../src/bot/auth.js";
import { handleAuditCommand } from "../src/bot/commands.js";

before(async () => {
  console.log("Setting up isolated audit test database...");
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
  console.log("Cleaning up audit test database...");
  await prisma.$disconnect();
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-audit.db",
    "./prisma/dev-test-audit.db-journal",
    "./dev-test-audit.db",
    "./dev-test-audit.db-journal",
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

test("Curation Log Operations", async (t) => {
  await prisma.curationLog.deleteMany({});

  await t.test("should save and retrieve curation logs with filters", async () => {
    await saveCurationLog({
      title: "Google AI News",
      url: "https://example.com/ai",
      source: "TechCrunch",
      topic: "tech",
      status: "POSTED",
      score: 85,
      breakdown: ["Matched keyword AI (+50)", "Trusted source (+35)"]
    });

    await saveCurationLog({
      title: "Bad Article",
      url: "https://example.com/bad",
      source: "Spammer",
      topic: "tech",
      status: "SKIPPED_THRESHOLD",
      score: 10,
      breakdown: ["No keyword matches (+10)"]
    });

    await saveCurationLog({
      title: "Another Topic News",
      url: "https://example.com/other",
      source: "ESPN",
      topic: "sports",
      status: "POSTED",
      score: 90,
      breakdown: ["Matched sports keyword (+90)"]
    });

    // Get all logs for topic tech
    const techLogs = await getCurationLogs({ topic: "tech" });
    assert.equal(techLogs.length, 2);

    // Get filter by status
    const postedLogs = await getCurationLogs({ topic: "tech", status: "POSTED" });
    assert.equal(postedLogs.length, 1);
    assert.equal(postedLogs[0].title, "Google AI News");

    // Get filter by query search
    const queryLogs = await getCurationLogs({ topic: "tech", query: "Bad" });
    assert.equal(queryLogs.length, 1);
    assert.equal(queryLogs[0].title, "Bad Article");

    // Check raw score and parsed breakdown list
    assert.equal(postedLogs[0].score, 85);
    const parsed = JSON.parse(postedLogs[0].breakdown);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0], "Matched keyword AI (+50)");
  });
});

test("isBotManager Auth Gate", async (t) => {
  const originalEnv = { ...process.env };

  t.after(() => {
    process.env = originalEnv;
  });

  await t.test("should authorize if user ID matches BOT_MANAGER_USER_IDS", async () => {
    process.env.BOT_MANAGER_USER_IDS = "111,222,333";
    process.env.BOT_MANAGER_ROLE_IDS = "444,555";

    const mockInteraction: any = {
      user: { id: "222" },
      member: { roles: { cache: new Map() } },
    };

    assert.ok(isBotManager(mockInteraction));
  });

  await t.test("should authorize if user has role in BOT_MANAGER_ROLE_IDS", async () => {
    process.env.BOT_MANAGER_USER_IDS = "111";
    process.env.BOT_MANAGER_ROLE_IDS = "444,555";

    const roleCache = new Map();
    roleCache.set("555", {});

    const mockInteraction: any = {
      user: { id: "999" },
      member: { roles: { cache: roleCache } },
    };

    assert.ok(isBotManager(mockInteraction));
  });

  await t.test("should fallback to ManageGuild permission if both env vars are empty", async () => {
    process.env.BOT_MANAGER_USER_IDS = "";
    process.env.BOT_MANAGER_ROLE_IDS = "";

    const mockInteractionHasPerm: any = {
      user: { id: "999" },
      member: { roles: { cache: new Map() } },
      memberPermissions: {
        has: (flag: any) => true,
      },
    };

    const mockInteractionNoPerm: any = {
      user: { id: "999" },
      member: { roles: { cache: new Map() } },
      memberPermissions: {
        has: (flag: any) => false,
      },
    };

    assert.ok(isBotManager(mockInteractionHasPerm));
    assert.equal(isBotManager(mockInteractionNoPerm), false);
  });

  await t.test("should not authorize if both lists configured but user matches neither", async () => {
    process.env.BOT_MANAGER_USER_IDS = "111";
    process.env.BOT_MANAGER_ROLE_IDS = "444";

    const mockInteraction: any = {
      user: { id: "999" },
      member: { roles: { cache: new Map() } },
      memberPermissions: {
        has: (flag: any) => true, // has ManageGuild but shouldn't matter since lists are set
      },
    };

    assert.equal(isBotManager(mockInteraction), false);
  });
});

test("handleAuditCommand execution", async (t) => {
  await prisma.curationLog.deleteMany({});

  const mockAppConfig: any = {
    topics: {
      tech: {},
    },
  };

  const originalEnv = { ...process.env };
  t.after(() => {
    process.env = originalEnv;
  });

  await t.test("should reject unauthorized users", async () => {
    process.env.BOT_MANAGER_USER_IDS = "111";
    process.env.BOT_MANAGER_ROLE_IDS = "";

    let replied = false;
    let replyPayload: any = null;

    const mockInteraction: any = {
      user: { id: "999" },
      options: {
        getString: (name: string) => "tech",
        getInteger: (name: string) => null,
      },
      reply: async (payload: any) => {
        replied = true;
        replyPayload = payload;
        return {} as any;
      },
    };

    await handleAuditCommand(mockInteraction, mockAppConfig);
    assert.ok(replied);
    assert.equal(replyPayload.content, "You do not have permission to run this command.");
  });

  await t.test("should display logs directly in message if short", async () => {
    process.env.BOT_MANAGER_USER_IDS = "111";
    process.env.BOT_MANAGER_ROLE_IDS = "";

    await saveCurationLog({
      title: "Small Log Title",
      url: "https://example.com/small",
      source: "TechCrunch",
      topic: "tech",
      status: "POSTED",
      score: 95,
      breakdown: ["Reason 1"]
    });

    let deferred = false;
    let replyPayload: any = null;

    const mockInteraction: any = {
      user: { id: "111" },
      options: {
        getString: (name: string) => {
          if (name === "topic") return "tech";
          return null;
        },
        getInteger: (name: string) => null,
      },
      deferReply: async (opts: any) => {
        deferred = true;
      },
      editReply: async (payload: any) => {
        replyPayload = payload;
        return {} as any;
      },
    };

    await handleAuditCommand(mockInteraction, mockAppConfig);
    assert.ok(deferred);
    assert.ok(replyPayload.content.includes("Curation Audit Logs for topic: \"tech\""));
    assert.ok(replyPayload.content.includes("Small Log Title"));
  });

  await t.test("should upload text file attachment if limit > 15", async () => {
    process.env.BOT_MANAGER_USER_IDS = "111";
    process.env.BOT_MANAGER_ROLE_IDS = "";

    let deferred = false;
    let replyPayload: any = null;

    const mockInteraction: any = {
      user: { id: "111" },
      options: {
        getString: (name: string) => {
          if (name === "topic") return "tech";
          return null;
        },
        getInteger: (name: string) => 20, // Limit 20 is > 15, should trigger file attachment
      },
      deferReply: async (opts: any) => {
        deferred = true;
      },
      editReply: async (payload: any) => {
        replyPayload = payload;
        return {} as any;
      },
    };

    await handleAuditCommand(mockInteraction, mockAppConfig);
    assert.ok(deferred);
    assert.ok(replyPayload.content.includes("Attached is the full log text file"));
    assert.ok(replyPayload.files && replyPayload.files.length === 1);
  });
});
