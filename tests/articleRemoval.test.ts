import { execSync } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";

const TEST_DB_URL = "file:./dev-test-remove.db";
const TEST_DB_FILE = "./prisma/dev-test-remove.db";
process.env.DATABASE_URL = TEST_DB_URL;

import { prisma } from "../src/storage/prismaClient.js";
import { handleRemoveArticleCommand, handleRemoveArticleModal, handleAuditCommand } from "../src/bot/commands.js";

before(async () => {
  console.log("Setting up isolated remove test database...");
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
  console.log("Cleaning up remove test database...");
  await prisma.$disconnect();
  cleanUpTestFiles();
});

function cleanUpTestFiles() {
  const filesToDelete = [
    "./prisma/dev-test-remove.db",
    "./prisma/dev-test-remove.db-journal",
    "./dev-test-remove.db",
    "./dev-test-remove.db-journal",
  ];
  for (const file of filesToDelete) {
    try {
      if (existsSync(file)) {
        rmSync(file, { force: true });
      }
    } catch (err) {}
  }
}

function createEmptyTestDbFile() {
  closeSync(openSync(TEST_DB_FILE, "w"));
}

test("Manual Article Removal Flow", async (t) => {
  const originalEnv = { ...process.env };
  t.after(() => {
    process.env = originalEnv;
  });

  process.env.BOT_MANAGER_USER_IDS = "111";
  process.env.BOT_MANAGER_ROLE_IDS = "";

  await t.test("handleRemoveArticleCommand - unauthorized should fail", async () => {
    let replied = false;
    let replyPayload: any = null;

    const mockInteraction: any = {
      user: { id: "999" },
      targetMessage: { id: "msg-1" },
      reply: async (payload: any) => {
        replied = true;
        replyPayload = payload;
      }
    };

    await handleRemoveArticleCommand(mockInteraction);
    assert.ok(replied);
    assert.match(replyPayload.content, /You do not have permission/);
  });

  await t.test("handleRemoveArticleCommand - missing article in db should fail", async () => {
    let replied = false;
    let replyPayload: any = null;

    const mockInteraction: any = {
      user: { id: "111" },
      targetMessage: { id: "msg-999" },
      reply: async (payload: any) => {
        replied = true;
        replyPayload = payload;
      }
    };

    await handleRemoveArticleCommand(mockInteraction);
    assert.ok(replied);
    assert.match(replyPayload.content, /Error: This message is not associated with/);
  });

  await t.test("handleRemoveArticleCommand - happy path, shows modal", async () => {
    // Seed article in database
    await prisma.article.create({
      data: {
        id: "art-1",
        topic: "tech",
        title: "Test article",
        url: "https://example.com/test",
        source: "TechCrunch",
        score: 80,
        discordChannelId: "channel-1",
        discordMessageId: "msg-1",
        status: "POSTED"
      }
    });

    let modalShown = false;
    let modalBuilder: any = null;

    const mockInteraction: any = {
      user: { id: "111" },
      targetMessage: { id: "msg-1" },
      showModal: async (modal: any) => {
        modalShown = true;
        modalBuilder = modal;
      }
    };

    await handleRemoveArticleCommand(mockInteraction);
    assert.ok(modalShown);
    assert.equal(modalBuilder.data.title, "Remove Article");
    assert.equal(modalBuilder.data.custom_id, "remove-article-modal_msg-1");
  });

  await t.test("handleRemoveArticleModal - happy path, removes message and logs reason", async () => {
    // Seed original curation log
    await prisma.curationLog.create({
      data: {
        title: "Test article",
        url: "https://example.com/test",
        source: "TechCrunch",
        topic: "tech",
        status: "POSTED",
        score: 80,
        breakdown: JSON.stringify(['Title matched keyword "deals" (+20)', 'Summary matched keyword "promo" (+10)'])
      }
    });

    let deferred = false;
    let editedReply = false;
    let replyPayload: any = null;
    let deletedMessage = false;

    const mockClient: any = {
      channels: {
        fetch: async (id: string) => {
          return {
            isTextBased: () => true,
            messages: {
              fetch: async (msgId: string) => {
                return {
                  delete: async () => {
                    deletedMessage = true;
                  }
                };
              }
            }
          };
        }
      }
    };

    const mockInteraction: any = {
      user: { id: "111" },
      customId: "remove-article-modal_msg-1",
      fields: {
        getTextInputValue: (name: string) => {
          if (name === "reason") return "Not relevant/off-topic";
          return "";
        }
      },
      deferReply: async (opts: any) => {
        deferred = true;
      },
      editReply: async (payload: any) => {
        editedReply = true;
        replyPayload = payload;
      }
    };

    await handleRemoveArticleModal(mockInteraction, mockClient);
    assert.ok(deferred);
    assert.ok(editedReply);
    assert.ok(deletedMessage);

    // Assert database states
    const updatedArticle = await prisma.article.findUnique({
      where: {
        id_topic: {
          id: "art-1",
          topic: "tech"
        }
      }
    });
    assert.equal(updatedArticle?.status, "REMOVED");
    assert.equal(updatedArticle?.statusReason, "Not relevant/off-topic");

    const removedCurationLogs = await prisma.curationLog.findMany({
      where: {
        topic: "tech",
        status: "REMOVED"
      }
    });
    assert.equal(removedCurationLogs.length, 1);
    assert.equal(removedCurationLogs[0].title, "Test article");
    assert.equal(removedCurationLogs[0].score, 80);

    const parsedBreakdown = JSON.parse(removedCurationLogs[0].breakdown);
    assert.ok(parsedBreakdown.includes("Removed by operator. Reason: Not relevant/off-topic"));
    assert.ok(parsedBreakdown.includes("Original: Title matched keyword \"deals\" (+20)"));

    // Verify diagnostic confirmation message content
    assert.match(replyPayload.content, /🗑️ \*\*Article Removed\.\*\*/);
    assert.match(replyPayload.content, /Reason:\*\* Not relevant\/off-topic/);
    assert.match(replyPayload.content, /Title matched keyword "deals" \(\+20\)/);
  });

  await t.test("handleRemoveArticleModal - does not mark removed if Discord deletion fails", async () => {
    await prisma.article.create({
      data: {
        id: "art-delete-fail",
        topic: "tech",
        title: "Delete failure article",
        url: "https://example.com/delete-fail",
        source: "TechCrunch",
        score: 70,
        discordChannelId: "channel-1",
        discordMessageId: "msg-delete-fail",
        status: "POSTED"
      }
    });

    let replyPayload: any = null;

    const mockClient: any = {
      channels: {
        fetch: async (_id: string) => {
          return {
            isTextBased: () => true,
            messages: {
              fetch: async (_msgId: string) => {
                return {
                  delete: async () => {
                    throw new Error("Missing Permissions");
                  }
                };
              }
            }
          };
        }
      }
    };

    const mockInteraction: any = {
      user: { id: "111" },
      customId: "remove-article-modal_msg-delete-fail",
      fields: {
        getTextInputValue: (name: string) => {
          if (name === "reason") return "Should not be persisted";
          return "";
        }
      },
      deferReply: async (_opts: any) => {},
      editReply: async (payload: any) => {
        replyPayload = payload;
      }
    };

    await handleRemoveArticleModal(mockInteraction, mockClient);

    const article = await prisma.article.findUnique({
      where: {
        id_topic: {
          id: "art-delete-fail",
          topic: "tech"
        }
      }
    });
    assert.equal(article?.status, "POSTED");
    assert.equal(article?.statusReason, null);

    const removedLogs = await prisma.curationLog.findMany({
      where: {
        topic: "tech",
        url: "https://example.com/delete-fail",
        status: "REMOVED"
      }
    });
    assert.equal(removedLogs.length, 0);
    assert.match(replyPayload.content, /Database status was not changed/);
  });

  await t.test("handleAuditCommand - should display Culprit Keywords summary", async () => {
    let deferred = false;
    let replyPayload: any = null;

    const mockAppConfig: any = {
      topics: {
        tech: {},
      },
    };

    const mockInteraction: any = {
      user: { id: "111" },
      options: {
        getString: (name: string) => {
          if (name === "topic") return "tech";
          if (name === "status") return "REMOVED";
          return null;
        },
        getInteger: (name: string) => null,
      },
      deferReply: async (opts: any) => {
        deferred = true;
      },
      editReply: async (payload: any) => {
        replyPayload = payload;
      }
    };

    await handleAuditCommand(mockInteraction, mockAppConfig);
    assert.ok(deferred);
    assert.match(replyPayload.content, /⚠️ \*\*Culprit Keywords Summary \(Last 100 removals\)\*\*:/);
    assert.match(replyPayload.content, /Core Keywords:\*\* `deals` \(1x\), `promo` \(1x\)/);
  });
});
