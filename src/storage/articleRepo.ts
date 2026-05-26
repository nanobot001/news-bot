import type { Article, UserFavorite, EmailForward } from "@prisma/client";
import { prisma } from "./prismaClient.js";

import type { NormalizedEvent } from "../normalization/normalizedEvent.js";
import { normalizeUrl, normalizeTitle, sha256 } from "../processing/hashUtils.js";
import { ARTICLE_STATUSES, type ArticleStatus } from "./articleStatus.js";

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

  const dedupeWindowDays = process.env.DEDUPE_WINDOW_DAYS ? parseInt(process.env.DEDUPE_WINDOW_DAYS, 10) : 7;
  const cutoff = new Date(Date.now() - dedupeWindowDays * 24 * 60 * 60 * 1000);

  const existing = await prisma.article.findFirst({
    where: {
      firstSeenAt: { gte: cutoff },
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
  postedAt?: Date | null,
  status?: ArticleStatus,
  statusReason?: string,
  discordMessageId?: string,
  discordChannelId?: string,
  anchorId?: string | null,
  anchorTopic?: string | null,
  storyThreadId?: string | null,
  lastStoryAddedAt?: Date | null
): Promise<Article> {
  const urlHash = event.url ? sha256(normalizeUrl(event.url)) : null;
  const titleHash = sha256(normalizeTitle(event.title));
  const articleStatus = status ?? (postedAt ? ARTICLE_STATUSES.POSTED : ARTICLE_STATUSES.INDEXED);

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
      status: articleStatus,
      statusReason: statusReason ?? null,
      rawJson: event.raw ? JSON.stringify(event.raw) : null,
      discordMessageId: discordMessageId !== undefined ? discordMessageId : undefined,
      discordChannelId: discordChannelId !== undefined ? discordChannelId : undefined,
      anchorId: anchorId !== undefined ? anchorId : undefined,
      anchorTopic: anchorTopic !== undefined ? anchorTopic : undefined,
      storyThreadId: storyThreadId !== undefined ? storyThreadId : undefined,
      lastStoryAddedAt: lastStoryAddedAt !== undefined ? lastStoryAddedAt : undefined,
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
      status: articleStatus,
      statusReason: statusReason ?? null,
      rawJson: event.raw ? JSON.stringify(event.raw) : null,
      discordMessageId: discordMessageId ?? null,
      discordChannelId: discordChannelId ?? null,
      anchorId: anchorId ?? null,
      anchorTopic: anchorTopic ?? null,
      storyThreadId: storyThreadId ?? null,
      lastStoryAddedAt: lastStoryAddedAt ?? null,
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

/**
 * Retrieves articles for a topic with optional filters for status (posted/unposted) and timeframe (in hours).
 */
export async function getArticlesForTopic(
  topic: string,
  statusFilter: "posted" | "unposted",
  hoursLimit?: number | null,
  limit = 10
): Promise<Article[]> {
  const whereClause: any = { topic };

  if (statusFilter === "posted") {
    whereClause.postedAt = { not: null };
  } else {
    whereClause.postedAt = null;
  }

  if (hoursLimit !== undefined && hoursLimit !== null && hoursLimit > 0) {
    const cutoff = new Date(Date.now() - hoursLimit * 60 * 60 * 1000);
    whereClause.firstSeenAt = { gte: cutoff };
  }

  return prisma.article.findMany({
    where: whereClause,
    orderBy: statusFilter === "posted" ? { postedAt: "desc" } : { firstSeenAt: "desc" },
    take: limit,
  });
}

/**
 * Prunes skipped/indexed articles that are older than the specified days.
 * Keeps posted articles forever.
 */
export async function pruneOldArticles(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.article.deleteMany({
    where: {
      status: { not: ARTICLE_STATUSES.POSTED },
      firstSeenAt: { lt: cutoff },
    },
  });
  return result.count;
}

/**
 * Retrieves an article by its Discord message ID.
 */
export async function getArticleByMessageId(messageId: string): Promise<Article | null> {
  return prisma.article.findFirst({
    where: { discordMessageId: messageId },
  });
}

/**
 * Persists a user's favorited article record (upserts to ensure idempotency).
 */
export async function saveFavorite(params: {
  userId: string;
  articleId: string;
  articleTopic: string;
  channelId: string;
  messageId: string;
  instapaperStatus: string;
}): Promise<UserFavorite> {
  return prisma.userFavorite.upsert({
    where: {
      userId_articleId_articleTopic: {
        userId: params.userId,
        articleId: params.articleId,
        articleTopic: params.articleTopic,
      },
    },
    update: {
      discordChannelId: params.channelId,
      discordMessageId: params.messageId,
      instapaperStatus: params.instapaperStatus,
    },
    create: {
      userId: params.userId,
      articleId: params.articleId,
      articleTopic: params.articleTopic,
      discordChannelId: params.channelId,
      discordMessageId: params.messageId,
      instapaperStatus: params.instapaperStatus,
    },
  });
}

/**
 * Retrieves a user's favorited articles with optional filtering options.
 */
export async function getFavorites(
  userId: string,
  filters: {
    topic?: string;
    query?: string;
    source?: string;
    since?: string;
    limit?: number;
  }
): Promise<Array<UserFavorite & { article: Article }>> {
  const whereClause: any = {
    userId,
  };

  if (filters.topic) {
    whereClause.articleTopic = filters.topic;
  }

  const articleConditions: any = {};

  if (filters.query) {
    const queryLower = filters.query.toLowerCase();
    articleConditions.OR = [
      { title: { contains: queryLower } },
      { source: { contains: queryLower } },
      { url: { contains: queryLower } },
    ];
  }

  if (filters.source) {
    articleConditions.source = { contains: filters.source.toLowerCase() };
  }

  if (Object.keys(articleConditions).length > 0) {
    whereClause.article = articleConditions;
  }

  if (filters.since) {
    const now = new Date();
    let cutoff: Date | null = null;

    const relativeMatch = filters.since.match(/^(\d+)([dhm])$/);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2];
      if (unit === "d") {
        cutoff = new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      } else if (unit === "h") {
        cutoff = new Date(now.getTime() - amount * 60 * 60 * 1000);
      } else if (unit === "m") {
        cutoff = new Date(now.getTime() - amount * 60 * 1000);
      }
    } else {
      const parsedDate = new Date(filters.since);
      if (!isNaN(parsedDate.getTime())) {
        cutoff = parsedDate;
      }
    }

    if (cutoff) {
      whereClause.savedAt = { gte: cutoff };
    }
  }

  return prisma.userFavorite.findMany({
    where: whereClause,
    include: {
      article: true,
    },
    orderBy: {
      savedAt: "desc",
    },
    take: filters.limit ?? 20,
  }) as any;
}

/**
 * Deletes a user's favorited article record (by composite unique key).
 */
export async function deleteFavorite(
  userId: string,
  articleId: string,
  articleTopic: string
): Promise<UserFavorite | null> {
  try {
    return await prisma.userFavorite.delete({
      where: {
        userId_articleId_articleTopic: {
          userId,
          articleId,
          articleTopic,
        },
      },
    });
  } catch (error) {
    return null;
  }
}

/**
 * Deletes a user's favorited article record by unique ID (with user security check).
 */
export async function deleteFavoriteById(
  userId: string,
  favoriteId: string
): Promise<any> {
  try {
    const favorite = await prisma.userFavorite.findFirst({
      where: { id: favoriteId, userId },
    });
    if (!favorite) {
      return null;
    }
    return await prisma.userFavorite.delete({
      where: { id: favoriteId },
      include: { article: true },
    });
  } catch (error) {
    return null;
  }
}

/**
 * Persists an email forwarding attempt record (upserts to support updates/retries).
 */
export async function saveEmailForward(params: {
  userId: string;
  articleId: string;
  articleTopic: string;
  channelId: string;
  messageId: string;
  recipientEmail: string;
  status: string;
  error?: string | null;
}): Promise<EmailForward> {
  return prisma.emailForward.upsert({
    where: {
      userId_articleId_articleTopic: {
        userId: params.userId,
        articleId: params.articleId,
        articleTopic: params.articleTopic,
      },
    },
    update: {
      discordChannelId: params.channelId,
      discordMessageId: params.messageId,
      recipientEmail: params.recipientEmail,
      status: params.status,
      error: params.error ?? null,
    },
    create: {
      userId: params.userId,
      articleId: params.articleId,
      articleTopic: params.articleTopic,
      discordChannelId: params.channelId,
      discordMessageId: params.messageId,
      recipientEmail: params.recipientEmail,
      status: params.status,
      error: params.error ?? null,
    },
  });
}

/**
 * Retrieves a single email forward attempt record by its composite unique key.
 */
export async function getEmailForward(
  userId: string,
  articleId: string,
  articleTopic: string
): Promise<EmailForward | null> {
  return prisma.emailForward.findUnique({
    where: {
      userId_articleId_articleTopic: {
        userId,
        articleId,
        articleTopic,
      },
    },
  });
}

/**
 * Persists a new curation log entry.
 */
export async function saveCurationLog(params: {
  title: string;
  url?: string | null;
  source: string;
  topic: string;
  status: string;
  score: number;
  breakdown: string[];
}): Promise<any> {
  return prisma.curationLog.create({
    data: {
      title: params.title,
      url: params.url ?? null,
      source: params.source,
      topic: params.topic,
      status: params.status,
      score: params.score,
      breakdown: JSON.stringify(params.breakdown),
    },
  });
}

/**
 * Retrieves curation logs for a given topic with optional search query, status filter, and limit.
 */
export async function getCurationLogs(params: {
  topic: string;
  limit?: number;
  query?: string;
  status?: string;
}): Promise<any[]> {
  const where: any = {
    topic: params.topic,
  };

  if (params.query) {
    where.title = {
      contains: params.query,
    };
  }

  if (params.status) {
    where.status = params.status;
  }

  return prisma.curationLog.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: params.limit ?? 10,
  });
}

/**
 * Retrieves posted articles from the last 24 hours that are parent story anchors
 * (i.e. anchorId is null) and are not marked as CLOSED.
 */
export async function getActiveAnchors(topic: string, limit = 20): Promise<Article[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.article.findMany({
    where: {
      topic,
      postedAt: { gte: cutoff },
      anchorId: null,
      status: ARTICLE_STATUSES.POSTED,
      OR: [
        { statusReason: null },
        { statusReason: { not: "CLOSED" } },
      ],
    },
    orderBy: { postedAt: "desc" },
    take: limit,
  });
}

/**
 * Sets the Discord thread ID for a parent story anchor.
 */
export async function setStoryThreadId(id: string, topic: string, threadId: string): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id, topic } },
    data: { storyThreadId: threadId },
  });
}

/**
 * Updates the lastStoryAddedAt timestamp for a parent story anchor.
 */
export async function updateLastStoryAddedAt(id: string, topic: string, timestamp: Date): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id, topic } },
    data: { lastStoryAddedAt: timestamp },
  });
}

/**
 * Marks a story anchor as CLOSED, meaning it will no longer receive automated thread updates.
 */
export async function closeStoryAnchor(id: string, topic: string): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id, topic } },
    data: { statusReason: "CLOSED" },
  });
}

/**
 * Links an article to a parent story anchor.
 */
export async function linkToAnchor(
  articleId: string,
  articleTopic: string,
  anchorId: string,
  anchorTopic: string,
  status: string
): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id: articleId, topic: articleTopic } },
    data: {
      anchorId,
      anchorTopic,
      status,
    },
  });
}

/**
 * Unlinks an article from its parent story anchor.
 */
export async function unlinkFromAnchor(
  articleId: string,
  articleTopic: string,
  newStatus: string
): Promise<Article> {
  return prisma.article.update({
    where: { id_topic: { id: articleId, topic: articleTopic } },
    data: {
      anchorId: null,
      anchorTopic: null,
      status: newStatus,
    },
  });
}

/**
 * Retrieves parent story anchors that have a storyThreadId, are not closed,
 * and have had no new articles or updates for more than 24 hours.
 */
export async function getInactiveStoryAnchors(inactiveThresholdMs = 24 * 60 * 60 * 1000): Promise<Article[]> {
  const cutoff = new Date(Date.now() - inactiveThresholdMs);
  return prisma.article.findMany({
    where: {
      anchorId: null,
      storyThreadId: { not: null },
      status: ARTICLE_STATUSES.POSTED,
      AND: [
        {
          OR: [
            { statusReason: null },
            { statusReason: { not: "CLOSED" } },
          ]
        },
        {
          postedAt: { lt: cutoff }
        },
        {
          OR: [
            { lastStoryAddedAt: null },
            { lastStoryAddedAt: { lt: cutoff } }
          ]
        }
      ]
    }
  });
}





