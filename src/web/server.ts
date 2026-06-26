import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../storage/prismaClient.js";
import type { AppConfig } from "../config/loadConfig.js";
import { runPeriodicReview } from "../services/llmReview.js";

import { type Client } from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startDashboard(appConfig: AppConfig, client: Client): void {
  const app = express();
  const port = process.env.DASHBOARD_PORT || 3000;

  app.use(express.json());
  
  // Serve static files from views folder
  const viewsPath = path.join(process.cwd(), "src", "web", "views");
  app.use(express.static(viewsPath));

  // Serve the dashboard HTML page
  app.get("/", (req, res) => {
    res.sendFile(path.join(viewsPath, "index.html"));
  });

  // API to trigger manual LLM review for all topics
  app.post("/api/review", async (req, res) => {
    try {
      const topics = Object.keys(appConfig.topics);
      console.log(`[Dashboard API] Manual LLM review triggered for topics: ${topics.join(", ")}`);
      for (const topic of topics) {
        await runPeriodicReview(topic, client);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[Dashboard API] Error running manual LLM review:", error);
      res.status(500).json({ error: "Failed to run LLM review" });
    }
  });

  // API to fetch active stories grouped by event
  app.get("/api/stories", async (req, res) => {
    try {
      const topic = req.query.topic as string;
      const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 48;
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

      const whereClause: any = {
        createdAt: { gte: cutoff }
      };
      if (topic) {
        whereClause.topic = topic;
      }

      const stories = await prisma.story.findMany({
        where: whereClause,
        include: {
          articles: {
            orderBy: { publishedAt: "desc" }
          },
          event: true
        },
        orderBy: { lastActivityAt: "desc" }
      });

      res.json(stories);
    } catch (error) {
      console.error("[Dashboard API] Error fetching stories:", error);
      res.status(500).json({ error: "Failed to fetch stories" });
    }
  });

  // API to fetch LLM review logs
  app.get("/api/logs", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const logs = await prisma.llmReviewLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit
      });
      res.json(logs);
    } catch (error) {
      console.error("[Dashboard API] Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // API to fetch topics for the filter dropdown
  app.get("/api/topics", (req, res) => {
    res.json(Object.keys(appConfig.topics));
  });

  // API to manually merge two stories
  app.post("/api/stories/merge", async (req, res) => {
    const { sourceStoryId, targetStoryId, reason } = req.body;
    if (!sourceStoryId || !targetStoryId) {
      res.status(400).json({ error: "Missing sourceStoryId or targetStoryId" });
      return;
    }

    try {
      const sourceStory = await prisma.story.findUnique({ where: { id: sourceStoryId } });
      const targetStory = await prisma.story.findUnique({ where: { id: targetStoryId } });

      if (!sourceStory || !targetStory) {
        res.status(404).json({ error: "One or both stories not found" });
        return;
      }

      await prisma.$transaction([
        prisma.article.updateMany({
          where: { storyId: sourceStoryId },
          data: { storyId: targetStoryId }
        }),
        prisma.story.update({
          where: { id: sourceStoryId },
          data: {
            status: "MERGED",
            mergedIntoId: targetStoryId
          }
        }),
        prisma.llmReviewLog.create({
          data: {
            topic: targetStory.topic,
            actionType: "MERGE",
            targetId: sourceStoryId,
            targetType: "STORY",
            confidence: 1.0,
            reason: `Manually merged by operator. Reason: ${reason || "None specified"}`
          }
        })
      ]);

      res.json({ success: true });
    } catch (error) {
      console.error("[Dashboard API] Error merging stories:", error);
      res.status(500).json({ error: "Failed to merge stories" });
    }
  });

  // API to manually split/reassign an article
  app.post("/api/articles/reassign", async (req, res) => {
    const { articleId, articleTopic, targetStoryId, newStoryTitle, reason } = req.body;
    if (!articleId || !articleTopic || !targetStoryId) {
      res.status(400).json({ error: "Missing articleId, articleTopic, or targetStoryId" });
      return;
    }

    try {
      if (targetStoryId === "NEW") {
        const title = newStoryTitle || "New Story Thread";
        const newStory = await prisma.story.create({
          data: {
            topic: articleTopic,
            title
          }
        });

        await prisma.$transaction([
          prisma.article.update({
            where: { id_topic: { id: articleId, topic: articleTopic } },
            data: { storyId: newStory.id }
          }),
          prisma.llmReviewLog.create({
            data: {
              topic: articleTopic,
              actionType: "SPLIT",
              targetId: articleId,
              targetType: "ARTICLE",
              confidence: 1.0,
              reason: `Manually split by operator. Reason: ${reason || "None specified"}`
            }
          })
        ]);
      } else {
        await prisma.$transaction([
          prisma.article.update({
            where: { id_topic: { id: articleId, topic: articleTopic } },
            data: { storyId: targetStoryId }
          }),
          prisma.llmReviewLog.create({
            data: {
              topic: articleTopic,
              actionType: "REASSIGN",
              targetId: articleId,
              targetType: "ARTICLE",
              confidence: 1.0,
              reason: `Manually reassigned by operator. Reason: ${reason || "None"}`
            }
          })
        ]);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Dashboard API] Error reassigning article:", error);
      res.status(500).json({ error: "Failed to reassign article" });
    }
  });

  app.listen(port, () => {
    console.log(`[Dashboard] Editorial control panel running at http://localhost:${port}`);
  });
}
