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
      OR: [
        // 1. Duplicate within the current topic (posted or not)
        {
          topic,
          firstSeenAt: { gte: cutoff },
          OR: conditions,
        },
        // 2. Duplicate in sibling topics that share the same channel, but only if actually posted
        ...(targetTopics.length > 0
          ? [
              {
                topic: { in: targetTopics },
                postedAt: { not: null },
                firstSeenAt: { gte: cutoff },
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
  storyId?: string | null,
  routingMetadata?: {
    intent: string;
    intentConfidence: number;
    route: string;
    routeReason: string;
  }
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
      storyId: storyId !== undefined ? storyId : undefined,
      intent: routingMetadata?.intent !== undefined ? routingMetadata.intent : undefined,
      intentConfidence: routingMetadata?.intentConfidence !== undefined ? routingMetadata.intentConfidence : undefined,
      route: routingMetadata?.route !== undefined ? routingMetadata.route : undefined,
      routeReason: routingMetadata?.routeReason !== undefined ? routingMetadata.routeReason : undefined,
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
      storyId: storyId ?? null,
      intent: routingMetadata?.intent ?? null,
      intentConfidence: routingMetadata?.intentConfidence ?? null,
      route: routingMetadata?.route ?? null,
      routeReason: routingMetadata?.routeReason ?? null,
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
 * Prunes only disposable indexing records that are older than the specified days.
 * Preserves actionable digest, review, coverage, and posted records.
 */
export async function pruneOldArticles(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const disposableStatuses = [
    ARTICLE_STATUSES.INDEXED,
    ARTICLE_STATUSES.SKIPPED_OLD,
    ARTICLE_STATUSES.SKIPPED_LOW_SCORE,
    ARTICLE_STATUSES.SKIPPED_FILTERED,
    ARTICLE_STATUSES.SKIPPED_INTENT,
  ];
  const result = await prisma.article.deleteMany({
    where: {
      status: { in: disposableStatuses },
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
  source?: string;
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

  if (params.source) {
    where.source = {
      contains: params.source,
    };
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
 * Retrieves pending digest articles for a specific topic and intent lane.
 */
export async function getPendingDigestArticles(
  topic: string,
  intent: string,
  limit: number = 25
): Promise<Article[]> {
  return prisma.article.findMany({
    where: {
      topic,
      intent,
      status: ARTICLE_STATUSES.DIGEST_PENDING,
    },
    orderBy: { score: "desc" },
    take: limit,
  });
}

/**
 * Marks multiple articles as posted digest.
 */
export async function markArticlesAsPostedDigest(
  ids: string[],
  topic: string,
  messageId: string,
  channelId: string
): Promise<void> {
  await prisma.article.updateMany({
    where: {
      id: { in: ids },
      topic,
    },
    data: {
      status: ARTICLE_STATUSES.POSTED_DIGEST,
      postedAt: new Date(),
      discordMessageId: messageId,
      discordChannelId: channelId,
    },
  });
}

