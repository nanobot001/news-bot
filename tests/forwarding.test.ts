import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

const TEST_DB_URL = "file:./dev-test-fwd.db";
const TEST_DB_FILE = "./prisma/dev-test-fwd.db";
process.env.DATABASE_URL = TEST_DB_URL;

// Set up mock env vars
process.env.FORWARD_DESTINATION_EMAIL = "recipient@example.com";
process.env.FORWARD_EMAIL_EMOJI = "📧";

import nodemailer from "nodemailer";
import { prisma } from "../src/storage/prismaClient.js";
import { saveArticle, saveEmailForward, getEmailForward } from "../src/storage/articleRepo.js";
import { handleReactionAdd } from "../src/bot/reactionListener.js";
import { sendForward, resetCachedTransporter } from "../src/services/emailService.js";

// Mock nodemailer transporter
let mailSentCount = 0;
let lastSentMail: any = null;
const originalCreateTransport = nodemailer.createTransport;
const originalCreateTestAccount = nodemailer.createTestAccount;

before(async () => {
  console.log("Setting up isolated forwarding test database...");
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

  // Override nodemailer methods for mock testing
  nodemailer.createTransport = ((config: any) => {
    return {
      sendMail: async (options: any) => {
        mailSentCount++;
        lastSentMail = options;
        return {
          messageId: "mock-message-id-123",
        };
      },
    } as any;
  }) as any;

  nodemailer.createTestAccount = (async () => {
    return {
      user: "mock-user@ethereal.email",
      pass: "mock-pass",
      web: "https://ethereal.email",
      smtp: { host: "smtp.ethereal.email", port: 587, secure: false },
      imap: { host: "imap.ethereal.email", port: 993, secure: true },
      pop3: { host: "pop3.ethereal.email", port: 995, secure: true },
    };
  }) as any;
});

after(async () => {
  console.log("Cleaning up forwarding test database...");
  await prisma.$disconnect();
  cleanUpTestFiles();

  // Restore nodemailer
  nodemailer.createTransport = originalCreateTransport;
  nodemailer.createTestAccount = originalCreateTestAccount;
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-fwd.db",
    "./prisma/dev-test-fwd.db-journal",
    "./dev-test-fwd.db",
    "./dev-test-fwd.db-journal",
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

test("Database EmailForward operations", async (t) => {
  await prisma.emailForward.deleteMany({});
  await prisma.article.deleteMany({});

  const event = {
    id: "art-fwd-1",
    type: "news.article",
    topic: "tech",
    title: "Prisma Schema Updated Successfully",
    url: "https://example.com/prisma",
    sourceName: "TechCrunch",
  };

  await saveArticle(event, 75, new Date(), "POSTED", undefined, "msg-fwd-123", "chan-fwd");

  await t.test("should save and retrieve an email forward record", async () => {
    const record = await saveEmailForward({
      userId: "user-1",
      articleId: "art-fwd-1",
      articleTopic: "tech",
      channelId: "chan-fwd",
      messageId: "msg-fwd-123",
      recipientEmail: "recipient@example.com",
      status: "SUCCESS",
    });

    assert.ok(record);
    assert.equal(record.status, "SUCCESS");
    assert.equal(record.userId, "user-1");

    const retrieved = await getEmailForward("user-1", "art-fwd-1", "tech");
    assert.ok(retrieved);
    assert.equal(retrieved.status, "SUCCESS");
  });

  await t.test("should support idempotency by updating existing records", async () => {
    // Modify status of same unique composite key [userId, articleId, articleTopic]
    const updated = await saveEmailForward({
      userId: "user-1",
      articleId: "art-fwd-1",
      articleTopic: "tech",
      channelId: "chan-fwd",
      messageId: "msg-fwd-123",
      recipientEmail: "recipient@example.com",
      status: "FAILED",
      error: "Connection timeout",
    });

    assert.equal(updated.status, "FAILED");
    assert.equal(updated.error, "Connection timeout");

    const allRecordsCount = await prisma.emailForward.count();
    assert.equal(allRecordsCount, 1, "Should have updated the existing record, not created a new one");
  });
});

test("Email Service sendForward", async (t) => {
  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    mailSentCount = 0;
    lastSentMail = null;
    resetCachedTransporter();
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test("should return error if FORWARD_DESTINATION_EMAIL is missing", async () => {
    delete process.env.FORWARD_DESTINATION_EMAIL;
    const res = await sendForward({
      articleUrl: "https://example.com/prisma",
      articleTitle: "Test Article",
      source: "TechCrunch",
      topic: "tech",
      discordMessageLink: "https://discord.com/channels/123/456/789",
    });

    assert.equal(res.success, false);
    assert.equal(res.error, "FORWARD_DESTINATION_EMAIL is not configured in environment variables.");
    assert.equal(mailSentCount, 0);
  });

  await t.test("should successfully build message and call nodemailer transporter", async () => {
    process.env.FORWARD_DESTINATION_EMAIL = "test-target@example.com";
    const res = await sendForward({
      articleUrl: "https://example.com/prisma",
      articleTitle: "Test Article Title",
      source: "TechCrunch",
      topic: "tech",
      discordMessageLink: "https://discord.com/channels/123/456/789",
    });

    assert.equal(res.success, true);
    assert.equal(res.recipient, "test-target@example.com");
    assert.equal(mailSentCount, 1);
    assert.ok(lastSentMail);
    assert.equal(lastSentMail.to, "test-target@example.com");
    assert.ok(lastSentMail.subject.includes("Test Article Title"));
    assert.ok(lastSentMail.text.includes("https://example.com/prisma"));
    assert.ok(lastSentMail.html.includes("TechCrunch"));
  });
});

test("Reaction-based Email Forwarding Event Handling", async (t) => {
  await prisma.emailForward.deleteMany({});
  await prisma.article.deleteMany({});

  const event = {
    id: "art-react-fwd",
    type: "news.article",
    topic: "science",
    title: "SpaceX Reusable Rocket Test",
    url: "https://example.com/spacex",
    sourceName: "NASA",
  };
  await saveArticle(event, 85, new Date(), "POSTED", undefined, "msg-react-fwd-123", "chan-science");

  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    mailSentCount = 0;
    lastSentMail = null;
    resetCachedTransporter();
    process.env.FORWARD_DESTINATION_EMAIL = "fwd-target@example.com";
    process.env.FORWARD_EMAIL_EMOJI = "📧";
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test("should forward email on configured emoji reaction and send DM notification", async () => {
    let dmSent = false;
    let dmContent = "";
    let reactionAddedToMessage = "";

    const mockReaction: any = {
      partial: false,
      emoji: { name: "📧" },
      message: {
        partial: false,
        id: "msg-react-fwd-123",
        channelId: "chan-science",
        guildId: "guild-123",
        react: async (emoji: string) => {
          reactionAddedToMessage = emoji;
          return {} as any;
        },
      },
    };

    const mockUser: any = {
      bot: false,
      id: "user-react-fwd-1",
      username: "FwdTester",
      createDM: async () => {
        return {
          send: async (msg: string) => {
            dmSent = true;
            dmContent = msg;
            return {} as any;
          },
        };
      },
    };

    await handleReactionAdd(mockReaction, mockUser);

    // Verify database record
    const record = await getEmailForward("user-react-fwd-1", "art-react-fwd", "science");
    assert.ok(record);
    assert.equal(record.status, "SUCCESS");

    // Verify email was sent
    assert.equal(mailSentCount, 1);
    assert.ok(lastSentMail);
    assert.equal(lastSentMail.to, "fwd-target@example.com");

    // Verify DM notification was sent
    assert.ok(dmSent);
    assert.ok(dmContent.includes("Successfully forwarded article"));

    // Verify channel reaction was added
    assert.equal(reactionAddedToMessage, "✅");
  });

  await t.test("should be idempotent (do not send email twice for same reaction/user)", async () => {
    // Record already exists as SUCCESS from previous test. Let's trigger reaction again.
    const mockReaction: any = {
      partial: false,
      emoji: { name: "📧" },
      message: {
        partial: false,
        id: "msg-react-fwd-123",
        channelId: "chan-science",
        guildId: "guild-123",
      },
    };

    const mockUser: any = {
      bot: false,
      id: "user-react-fwd-1",
      username: "FwdTester",
      createDM: async () => {
        return {
          send: async (msg: string) => {
            return {} as any;
          },
        };
      },
    };

    await handleReactionAdd(mockReaction, mockUser);

    // mailSentCount should still be 0 since beforeEach reset it and the reaction handler should skip due to SUCCESS state
    assert.equal(mailSentCount, 0, "Email should not have been sent again");
  });

  await t.test("should ignore non-configured reaction emoji", async () => {
    const mockReaction: any = {
      partial: false,
      emoji: { name: "🚀" },
      message: {
        partial: false,
        id: "msg-react-fwd-123",
        channelId: "chan-science",
        guildId: "guild-123",
      },
    };

    const mockUser: any = {
      bot: false,
      id: "user-react-fwd-2",
      username: "RocketTester",
    };

    await handleReactionAdd(mockReaction, mockUser);

    // No record should be created, no mail should be sent
    const record = await getEmailForward("user-react-fwd-2", "art-react-fwd", "science");
    assert.equal(record, null);
    assert.equal(mailSentCount, 0);
  });

  await t.test("should forward email on standard envelope reaction (✉️) when no custom emoji is set", async () => {
    delete process.env.FORWARD_EMAIL_EMOJI;

    let dmSent = false;
    const mockReaction: any = {
      partial: false,
      emoji: { name: "✉️" },
      message: {
        partial: false,
        id: "msg-react-fwd-123",
        channelId: "chan-science",
        guildId: "guild-123",
      },
    };

    const mockUser: any = {
      bot: false,
      id: "user-react-fwd-3",
      username: "EnvelopeTester",
      createDM: async () => {
        return {
          send: async () => {
            dmSent = true;
            return {} as any;
          },
        };
      },
    };

    await handleReactionAdd(mockReaction, mockUser);

    const record = await getEmailForward("user-react-fwd-3", "art-react-fwd", "science");
    assert.ok(record);
    assert.equal(record.status, "SUCCESS");
    assert.equal(mailSentCount, 1);
    assert.ok(dmSent);
  });
});

