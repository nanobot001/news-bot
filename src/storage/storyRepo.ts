import { prisma } from "./prismaClient.js";
import type { Story, Event, Article, StorySignal } from "@prisma/client";

export async function createEvent(topic: string, title: string): Promise<Event> {
  return prisma.event.create({
    data: {
      topic,
      title,
    },
  });
}

export async function createStory(topic: string, title: string, eventId?: string): Promise<Story> {
  let targetEventId = eventId;
  if (!targetEventId) {
    const event = await prisma.event.create({
      data: {
        topic,
        title,
      },
    });
    targetEventId = event.id;
  }
  return prisma.story.create({
    data: {
      topic,
      title,
      eventId: targetEventId,
    },
  });
}

export async function setEventThreadAndIndex(eventId: string, threadId: string, indexMessageId: string): Promise<Event> {
  return prisma.event.update({
    where: { id: eventId },
    data: {
      discordThreadId: threadId,
      indexMessageId,
    },
  });
}

export async function updateEventIndexMessageId(eventId: string, indexMessageId: string | null): Promise<Event> {
  return prisma.event.update({
    where: { id: eventId },
    data: { indexMessageId },
  });
}

export async function getActiveStories(topic: string, limit = 20): Promise<Story[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.story.findMany({
    where: {
      topic,
      createdAt: { gte: cutoff },
      status: "OPEN",
    },
    include: {
      signals: true,
      articles: true,
      event: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getStoryWithArticles(storyId: string) {
  return prisma.story.findUnique({
    where: { id: storyId },
    include: { articles: true },
  });
}

export async function setStoryThreadId(id: string, threadId: string): Promise<Story> {
  return prisma.story.update({
    where: { id },
    data: { discordThreadId: threadId },
  });
}

export async function updateLastActivityAt(id: string, timestamp: Date): Promise<Story> {
  return prisma.story.update({
    where: { id },
    data: { lastActivityAt: timestamp },
  });
}

export async function closeStory(id: string): Promise<Story> {
  return prisma.story.update({
    where: { id },
    data: { status: "CLOSED" },
  });
}

export async function linkArticleToStory(articleId: string, articleTopic: string, storyId: string): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id: articleId, topic: articleTopic } },
    data: { storyId },
  });
}

export async function unlinkArticleFromStory(articleId: string, articleTopic: string): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id: articleId, topic: articleTopic } },
    data: { storyId: null },
  });
}

export async function getInactiveStories(inactiveThresholdMs?: number): Promise<Story[]> {
  const limitHours = process.env.THREAD_INACTIVE_LIMIT_HOURS 
    ? parseFloat(process.env.THREAD_INACTIVE_LIMIT_HOURS) 
    : 12;
  const threshold = inactiveThresholdMs ?? (limitHours * 60 * 60 * 1000);
  const cutoff = new Date(Date.now() - threshold);
  
  return prisma.story.findMany({
    where: {
      status: "OPEN",
      discordThreadId: { not: null },
      lastActivityAt: { lt: cutoff },
    },
  });
}

export async function getInactiveEvents(inactiveThresholdMs?: number) {
  const limitHours = process.env.THREAD_INACTIVE_LIMIT_HOURS 
    ? parseFloat(process.env.THREAD_INACTIVE_LIMIT_HOURS) 
    : 12;
  const threshold = inactiveThresholdMs ?? (limitHours * 60 * 60 * 1000);
  const cutoff = new Date(Date.now() - threshold);

  return prisma.event.findMany({
    where: {
      discordThreadId: { not: null },
      stories: {
        every: {
          OR: [
            { status: { in: ["CLOSED", "MERGED"] } },
            { lastActivityAt: { lt: cutoff } },
          ],
        },
      },
    },
    include: {
      stories: true,
    },
  });
}

export async function closeEvent(id: string): Promise<void> {
  await prisma.story.updateMany({
    where: { eventId: id, status: "OPEN" },
    data: { status: "CLOSED" },
  });
  await prisma.event.update({
    where: { id },
    data: {
      discordThreadId: null,
      indexMessageId: null
    }
  });
}
