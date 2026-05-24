import type { Article } from "@prisma/client";
import { prisma } from "./prismaClient.js";
import type { NormalizedEvent } from "../normalization/normalizedEvent.js";
import { normalizeUrl, normalizeTitle, sha256 } from "../processing/hashUtils.js";

/**
 * Checks if an article is a duplicate within a specific topic or sharing topics context using a combined single query.
 */
export async function findDuplicateArticle(
  topic: string,
  id: string,
  url?: string,
  title?: string,
  sharingTopics?: string[]
): Promise<{ isDuplicate: boolean; reason: "guid" | "urlHash" | "titleHash" } | null> {
  const urlHash = url ? sha256(normalizeUrl(url)) : undefined;
  const titleHash = title ? sha256(normalizeTitle(title)) : undefined;

  const conditions: Array<Record<string, string>> = [{ id }];
  if (urlHash) {
    conditions.push({ urlHash });
  }
  if (titleHash) {
    conditions.push({ titleHash });
  }

  const targetTopics = sharingTopics && sharingTopics.length > 0
    ? sharingTopics.filter((t) => t !== topic)
    : [];

  const existing = await prisma.article.findFirst({
    where: {
      OR: [
        // 1. Duplicate within the current topic (posted or not)
        {
          topic,
          OR: conditions,
        },
        // 2. Duplicate in sibling topics that share the same channel, but only if actually posted
        ...(targetTopics.length > 0
          ? [
              {
                topic: { in: targetTopics },
                postedAt: { not: null },
                OR: conditions,
              },
            ]
          : []),
      ],
    },
  });

  if (!existing) {
    return null;
  }

  if (existing.id === id) {
    return { isDuplicate: true, reason: "guid" };
  }
  if (urlHash && existing.urlHash === urlHash) {
    return { isDuplicate: true, reason: "urlHash" };
  }
  if (titleHash && existing.titleHash === titleHash) {
    return { isDuplicate: true, reason: "titleHash" };
  }

  // Fallback to guid reason if somehow matched without matching hashes explicitly
  return { isDuplicate: true, reason: "guid" };
}

/**
 * Persists an article record (inserts or updates).
 */
export async function saveArticle(
  event: NormalizedEvent,
  score?: number,
  postedAt?: Date
): Promise<Article> {
  const urlHash = event.url ? sha256(normalizeUrl(event.url)) : null;
  const titleHash = sha256(normalizeTitle(event.title));

  return prisma.article.upsert({
    where: {
      id_topic: {
        id: event.id,
        topic: event.topic,
      },
    },
    update: {
      url: event.url,
      urlHash,
      title: event.title,
      titleHash,
      source: event.sourceName,
      publishedAt: event.publishedAt ? new Date(event.publishedAt) : null,
      postedAt: postedAt ?? null,
      score: score ?? null,
      rawJson: event.raw ? JSON.stringify(event.raw) : null,
    },
    create: {
      id: event.id,
      url: event.url,
      urlHash,
      title: event.title,
      titleHash,
      topic: event.topic,
      source: event.sourceName,
      publishedAt: event.publishedAt ? new Date(event.publishedAt) : null,
      postedAt: postedAt ?? null,
      score: score ?? null,
      rawJson: event.raw ? JSON.stringify(event.raw) : null,
    },
  });
}

/**
 * Retrieves a single article by ID.
 */
export async function getArticleById(id: string, topic?: string): Promise<Article | null> {
  if (topic) {
    return prisma.article.findUnique({
      where: {
        id_topic: { id, topic },
      },
    });
  }
  return prisma.article.findFirst({
    where: { id },
  });
}

/**
 * Retrieves articles for a topic, optionally limited to a certain number.
 */
export async function getArticlesByTopic(topic: string, limit = 20): Promise<Article[]> {
  return prisma.article.findMany({
    where: { topic },
    orderBy: { firstSeenAt: "desc" },
    take: limit,
  });
}

/**
 * Retrieves recently posted articles for a topic, ordered by postedAt descending.
 */
export async function getRecentlyPostedArticles(topic: string, limit = 10): Promise<Article[]> {
  return prisma.article.findMany({
    where: {
      topic,
      postedAt: { not: null },
    },
    orderBy: { postedAt: "desc" },
    take: limit,
  });
}

