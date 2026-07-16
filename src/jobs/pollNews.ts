import cron from "node-cron";
import { SnowflakeUtil, type Client } from "discord.js";
import type { AppConfig } from "../config/loadConfig.js";
import type { NormalizedEvent } from "../normalization/normalizedEvent.js";
import { fetchFeedItems } from "../ingestion/fetchFeeds.js";
import { normalizeRssItem } from "../normalization/normalizeRssItem.js";
import { checkDuplicate } from "../processing/dedupe.js";
import { scoreArticle } from "../processing/scoreArticle.js";
import { filterArticle } from "../processing/filterArticle.js";
import { saveArticle, pruneOldArticles, saveCurationLog } from "../storage/articleRepo.js";
import { createStory, getActiveStories, updateLastActivityAt, getInactiveStories, closeStory, setEventThreadAndIndex, getInactiveEvents, closeEvent } from "../storage/storyRepo.js";
import { extractSignals } from "../processing/signals.js";
import { updateEventIndex } from "../bot/indexManager.js";
import { prisma } from "../storage/prismaClient.js";
import { ARTICLE_STATUSES, type ArticleStatus, routeToPendingStatus } from "../storage/articleStatus.js";
import { formatArticleEmbed, postArticleToChannel } from "../bot/postEmbed.js";
import { calculateJaccardSimilarity, findBestStoryMatch } from "../processing/similarity.js";
import { classifyContentIntent, decideContentRoute } from "../processing/contentRouting.js";
import type { ContentRoutingResult } from "../processing/contentRouting.js";
import { buildPostingControlBudget, calculatePostingPriority, evaluatePostingControls, reserveImmediatePostingSlot } from "../processing/postingControls.js";
import { acquireLock, releaseLock } from "../utils/lock.js";
import { decodeGoogleNewsUrl } from "../utils/googleNewsResolver.js";
import { scrapeOgImage } from "../utils/ogImageScraper.js";
import { runPeriodicReview } from "../services/llmReview.js";
import { createCoverageIndexThread } from "../bot/threadUtils.js";

export type PollTopicCounts = {
  checked: number;
  newItems: number;
  skipped: number;
  posted: number;
  eligible?: number;
};

export type PollError = {
  topic: string;
  source: string;
  message: string;
};

function getThreadInactiveLimitHours(): number {
  const configured = process.env.THREAD_INACTIVE_LIMIT_HOURS
    ? parseFloat(process.env.THREAD_INACTIVE_LIMIT_HOURS)
    : 12;

  return Number.isFinite(configured) && configured > 0 ? configured : 12;
}

function getThreadActivityTimestamp(thread: any): number {
  if (typeof thread.lastMessage?.createdTimestamp === "number") {
    return thread.lastMessage.createdTimestamp;
  }

  if (typeof thread.createdTimestamp === "number") {
    return thread.createdTimestamp;
  }

  const activitySnowflake = thread.lastMessageId ?? thread.id;
  if (activitySnowflake) {
    try {
      return SnowflakeUtil.timestampFrom(activitySnowflake);
    } catch (_) {
      // Fall through to a conservative "now" timestamp if the mock or API value is not a snowflake.
    }
  }

  return Date.now();
}

async function archiveAndLockThread(threadChannel: any, reason: string): Promise<boolean> {
  try {
    await threadChannel.edit({
      archived: true,
      locked: true,
      reason,
    });
    console.log(`[Thread Cleanup] Archived & locked thread: "${threadChannel.name}" (${threadChannel.id})`);
    return true;
  } catch (editErr: any) {
    if (editErr.message === "Thread is archived" || editErr.code === 50083) {
      await threadChannel.setArchived(false, "Unarchiving to lock");
      await threadChannel.edit({
        archived: true,
        locked: true,
        reason,
      });
      console.log(`[Thread Cleanup] Locked already-archived thread: "${threadChannel.name}" (${threadChannel.id})`);
      return true;
    }

    throw editErr;
  }
}

export function classifySkipStatus(reasons: string[]): ArticleStatus {
  if (reasons.some((reason) => reason.includes("exceeds max age"))) {
    return ARTICLE_STATUSES.SKIPPED_OLD;
  }

  if (reasons.some((reason) => reason.includes("below threshold"))) {
    return ARTICLE_STATUSES.SKIPPED_LOW_SCORE;
  }

  return ARTICLE_STATUSES.SKIPPED_FILTERED;
}

function determineCurationStatus(
  shouldPost: boolean,
  route: string,
  scoreReasons: string[],
  filterReasons: string[]
): string {
  if (route === "digest_pending") return "DIGEST_PENDING";
  if (route === "review_pending") return "REVIEW_PENDING";
  if (route === "skip") return "SKIPPED_INTENT";
  
  if (shouldPost) return "POSTED";
  if (scoreReasons.some((r) => r.includes("Blocked term matched"))) return "SKIPPED_BLOCKED";
  if (filterReasons.some((r) => r.includes("cooldown") || r.includes("throttled"))) return "DEFERRED_COOLDOWN";
  return "SKIPPED_THRESHOLD";
}

/**
 * Runs a single, complete polling run for all topics and sources.
 * Gathers counts and catches errors at the source level.
 */
type PreparedPollCandidate = {
  topic: string;
  source: AppConfig["sources"][string][number];
  event: NormalizedEvent;
  scoringResult: ReturnType<typeof scoreArticle>;
  filteringResult: ReturnType<typeof filterArticle>;
  routingResult: ContentRoutingResult;
  routingMetadata: {
    intent: string;
    intentConfidence: number;
    route: string;
    routeReason: string;
  };
  curationBreakdown: string[];
  priority: number;
};

async function postImmediateCandidate(input: {
  client: Client;
  topic: string;
  topicConfig: AppConfig["topics"][string];
  source: AppConfig["sources"][string][number];
  event: NormalizedEvent;
  scoringResult: ReturnType<typeof scoreArticle>;
  routingResult: ContentRoutingResult;
  routingMetadata: {
    intent: string;
    intentConfidence: number;
    route: string;
    routeReason: string;
  };
}): Promise<{ posted: boolean; finalStatus: ArticleStatus; finalRoute: string; finalReason: string }> {
  const { client, topic, topicConfig, event, scoringResult, routingResult, routingMetadata } = input;
  const eventSignals = extractSignals(event);
  const activeStories = await getActiveStories(topic);
  const signalThreshold = process.env.SIGNAL_THRESHOLD ? parseFloat(process.env.SIGNAL_THRESHOLD) : 0.3;
  const similarityThreshold = process.env.SIMILARITY_THRESHOLD ? parseFloat(process.env.SIMILARITY_THRESHOLD) : 0.25;

  if (!event.imageUrl) {
    try {
      const scrapedImg = await scrapeOgImage(event.url);
      if (scrapedImg) {
        event.imageUrl = scrapedImg;
      }
    } catch (err) {
      console.warn(`[News Poll] Failed to scrape OG image for ${event.url}:`, err);
    }
  }

  const matchResult = findBestStoryMatch(
    event.title,
    eventSignals,
    activeStories as any,
    signalThreshold,
    similarityThreshold
  );

  const bestStory = matchResult.story;
  const bestScore = matchResult.score;
  const matchReason = matchResult.reason;

  if (bestStory && (bestStory as any).event?.discordThreadId) {
    const threadId = (bestStory as any).event.discordThreadId as string;
    const threadChannel = await client.channels.fetch(threadId);
    if (threadChannel?.isTextBased()) {
      const formattedEvent = {
        ...event,
        title: `[${bestStory.title}] ${event.title}`,
      };
      const embed = formatArticleEmbed({
        event: formattedEvent,
        score: scoringResult.score,
        emoji: topicConfig.emoji,
        intent: routingResult.intent,
      });
      const threadMsg = await (threadChannel as any).send({ embeds: [embed] });

      await saveArticle(
        event,
        scoringResult.score,
        new Date(),
        ARTICLE_STATUSES.RELATED_COVERAGE,
        `Clustered automatically via ${matchReason} check (Score: ${bestScore.toFixed(2)})`,
        threadMsg?.id ?? undefined,
        threadId,
        bestStory.id,
        routingMetadata
      );

      await updateLastActivityAt(bestStory.id, new Date());
      if ((bestStory as any).event) {
        await updateEventIndex(client, (bestStory as any).event.id);
      }

      return {
        posted: true,
        finalStatus: ARTICLE_STATUSES.RELATED_COVERAGE,
        finalRoute: routingResult.route,
        finalReason: `Clustered automatically via ${matchReason} check (Score: ${bestScore.toFixed(2)})`,
      };
    }
  }

  if (routingResult.route === "thread_only") {
    return {
      posted: false,
      finalStatus: ARTICLE_STATUSES.DIGEST_PENDING,
      finalRoute: "digest_pending",
      finalReason: "No related active story thread found for thread-only discussion item",
    };
  }

  const embed = formatArticleEmbed({
    event,
    score: scoringResult.score,
    emoji: topicConfig.emoji,
    intent: routingResult.intent,
  });
  const message = await postArticleToChannel(client, topicConfig.channelId, embed);
  const newStory = await createStory(topic, event.title);

  await saveArticle(
    event,
    scoringResult.score,
    new Date(),
    ARTICLE_STATUSES.POSTED,
    undefined,
    message?.id ?? undefined,
    message?.channelId ?? undefined,
    newStory.id,
    routingMetadata
  );

  if (eventSignals.length > 0) {
    await prisma.storySignal.createMany({
      data: eventSignals.map((sig) => ({
        storyId: newStory.id,
        articleId: event.id,
        articleTopic: topic,
        type: sig.type,
        value: sig.value,
        weight: sig.weight,
      })),
    }).catch((err) => console.warn("Failed to save article signals:", err));
  }

  return {
    posted: true,
    finalStatus: ARTICLE_STATUSES.POSTED,
    finalRoute: routingResult.route,
    finalReason: "Immediate slot available after posting controls",
  };
}

export async function pollNews(
  client: Client,
  config: AppConfig,
  errorsList?: PollError[],
  targetTopic?: string,
  forceDryRun = false
): Promise<Record<string, PollTopicCounts>> {
  if (!acquireLock()) {
    console.warn("[News Poll] Another polling job is already running. Skipping this execution.");
    return {};
  }

  try {
    const counts: Record<string, PollTopicCounts> = {};
    const topicsToPoll = targetTopic ? [targetTopic] : Object.keys(config.topics);

    for (const topic of topicsToPoll) {
      counts[topic] = {
        checked: 0,
        newItems: 0,
        skipped: 0,
        posted: 0,
        eligible: 0,
      };

      const topicConfig = config.topics[topic];
      if (!topicConfig || topicConfig.disabled) {
        continue;
      }

      const sources = config.sources[topic] || [];
      const preparedCandidates: PreparedPollCandidate[] = [];
      const postedArticles = await prisma.article.findMany({
        where: { topic, status: ARTICLE_STATUSES.POSTED },
      });
      const budget = buildPostingControlBudget(postedArticles);
      const isDryRun = forceDryRun || process.env.DRY_RUN === "true";

      for (const source of sources) {
        try {
          const result = await fetchFeedItems(source);
          for (const item of result.items) {
            counts[topic].checked++;
            const event = normalizeRssItem({ topic, source, item });

            if (event.publishedAt) {
              const pubDate = new Date(event.publishedAt);
              if (!isNaN(pubDate.getTime())) {
                const dedupeWindowDays = process.env.DEDUPE_WINDOW_DAYS ? parseInt(process.env.DEDUPE_WINDOW_DAYS, 10) : 7;
                const maxAgeMs = dedupeWindowDays * 24 * 60 * 60 * 1000;
                if (Date.now() - pubDate.getTime() > maxAgeMs) {
                  counts[topic].skipped++;
                  continue;
                }
              }
            }

            const sharingTopics = Object.entries(config.topics)
              .filter(([_, tc]) => tc.channelId === topicConfig.channelId)
              .map(([t]) => t);
            const dedupeResult = await checkDuplicate(event, sharingTopics);
            if (dedupeResult.isDuplicate) {
              counts[topic].skipped++;
              continue;
            }

            if (event.url.startsWith("https://news.google.com")) {
              try {
                const decodedUrl = await decodeGoogleNewsUrl(event.url);
                if (decodedUrl && decodedUrl !== event.url) {
                  event.url = decodedUrl;
                  const reCheck = await checkDuplicate(event, sharingTopics);
                  if (reCheck.isDuplicate) {
                    counts[topic].skipped++;
                    continue;
                  }
                }
              } catch (err) {
                console.warn(`[News Poll] Failed to decode Google News URL ${event.url}:`, err);
              }
            }

            if (event.url && (event.url.includes("youtube.com") || event.url.includes("youtu.be"))) {
              try {
                const ytResp = await fetch(event.url, {
                  headers: {
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "accept-language": "en-US,en;q=0.9",
                  },
                  signal: AbortSignal.timeout(8000),
                });
                if (ytResp.ok) {
                  const ytHtml = await ytResp.text();
                  const match = ytHtml.match(/<meta itemprop="datePublished" content="([^"]+)"/);
                  if (match && match[1]) {
                    const truePubDate = new Date(match[1]);
                    if (!isNaN(truePubDate.getTime())) {
                      event.publishedAt = truePubDate.toISOString();
                      const dedupeWindowDays = process.env.DEDUPE_WINDOW_DAYS ? parseInt(process.env.DEDUPE_WINDOW_DAYS, 10) : 7;
                      const maxAgeMs = dedupeWindowDays * 24 * 60 * 60 * 1000;
                      if (Date.now() - truePubDate.getTime() > maxAgeMs) {
                        console.log(`[News Poll] Skipping old YouTube video ${event.url} (true publish date: ${event.publishedAt})`);
                        counts[topic].skipped++;
                        continue;
                      }
                    }
                  }
                }
              } catch (err) {
                console.warn(`[News Poll] Failed to fetch true YouTube date for ${event.url}`, err);
              }
            }

            counts[topic].newItems++;
            const scoringResult = scoreArticle({
              event,
              keywords: topicConfig.keywords,
              locationKeywords: topicConfig.locationKeywords,
              blockedTerms: topicConfig.blockedTerms,
              trustedSource: source.trusted,
            });

            const intentClassification = classifyContentIntent(event, source);
            const routingThreshold = topicConfig.intentRouting?.[intentClassification.intent]?.postThreshold ?? topicConfig.postThreshold;
            const maxAgeHours = process.env.MAX_ARTICLE_AGE_HOURS ? parseInt(process.env.MAX_ARTICLE_AGE_HOURS, 10) : 24;
            const filteringResult = filterArticle({
              score: scoringResult.score,
              threshold: routingThreshold,
              isDuplicate: false,
              publishedAt: event.publishedAt,
              maxAgeHours,
            });

            const routingResult: ContentRoutingResult = {
              ...intentClassification,
              ...decideContentRoute({
                classification: intentClassification,
                topicConfig,
                source,
                score: scoringResult.score,
                filterAllowsPost: filteringResult.shouldPost,
                filterReasons: filteringResult.reasons,
              }),
            };

            const routingMetadata = {
              intent: routingResult.intent,
              intentConfidence: routingResult.confidence,
              route: routingResult.route,
              routeReason: routingResult.reason,
            };

            const curationBreakdown = [
              ...scoringResult.reasons,
              ...filteringResult.reasons,
              `Intent classified as ${routingResult.intent} (${routingResult.confidence.toFixed(2)})`,
              ...routingResult.reasons.map((reason) => `Routing: ${reason}`),
              `Selected route ${routingResult.route}: ${routingResult.reason}`,
            ];

            if (routingResult.route === "skip") {
              if (!isDryRun) {
                await saveArticle(
                  event,
                  scoringResult.score,
                  null,
                  classifySkipStatus(filteringResult.reasons),
                  filteringResult.reasons.join("; "),
                  undefined,
                  undefined,
                  null,
                  routingMetadata
                );
                await saveCurationLog({
                  title: event.title,
                  url: event.url,
                  source: event.sourceName,
                  topic: event.topic,
                  status: "SKIPPED",
                  score: scoringResult.score,
                  breakdown: curationBreakdown,
                }).catch((err) => console.error("Failed to save curation log:", err));
              }
              counts[topic].skipped++;
              continue;
            }

            preparedCandidates.push({
              topic,
              source,
              event,
              scoringResult,
              filteringResult,
              routingResult,
              routingMetadata,
              curationBreakdown,
              priority: calculatePostingPriority({
                score: scoringResult.score,
                source,
                routingResult,
                title: event.title,
                summary: event.summary,
                publishedAt: event.publishedAt,
                topic,
              }),
            });
            counts[topic].eligible!++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (errorsList) {
            errorsList.push({ topic, source: source.name, message });
          } else {
            console.error(`Error processing source "${source.name}" for topic "${topic}": ${message}`);
          }
        }
      }

      preparedCandidates.sort((left, right) => {
        if (right.priority !== left.priority) return right.priority - left.priority;
        return left.event.publishedAt && right.event.publishedAt
          ? new Date(right.event.publishedAt).getTime() - new Date(left.event.publishedAt).getTime()
          : 0;
      });

      for (const candidate of preparedCandidates) {
        const controlDecision = evaluatePostingControls({
          topic,
          source: candidate.source,
          topicConfig,
          routingResult: candidate.routingResult,
          score: candidate.scoringResult.score,
          title: candidate.event.title,
          summary: candidate.event.summary,
          publishedAt: candidate.event.publishedAt,
          budget,
        });

        const finalRoute = controlDecision.route;
        const finalStatus = controlDecision.status;
        const finalReason = controlDecision.reason;
        const finalRoutingMetadata = {
          ...candidate.routingMetadata,
          route: finalRoute,
          routeReason: finalReason,
        };
        const finalBreakdown = [
          ...candidate.curationBreakdown,
          ...controlDecision.reasons.map((reason) => `Posting controls: ${reason}`),
          `Final route ${finalRoute}: ${finalReason}`,
        ];

        if (isDryRun) {
          console.log(`[Dry Run] Would evaluate article: "${candidate.event.title}" -> ${finalStatus} / ${finalRoute}`);
          counts[topic].skipped++;
          continue;
        }

        if (finalStatus !== "POSTED") {
          await saveArticle(
            candidate.event,
            candidate.scoringResult.score,
            null,
            routeToPendingStatus(finalRoute, candidate.filteringResult.reasons),
            finalReason,
            undefined,
            undefined,
            null,
            finalRoutingMetadata
          );
          await saveCurationLog({
            title: candidate.event.title,
            url: candidate.event.url,
            source: candidate.event.sourceName,
            topic: candidate.event.topic,
            status: finalStatus,
            score: candidate.scoringResult.score,
            breakdown: finalBreakdown,
          }).catch((err) => console.error("Failed to save curation log:", err));
          counts[topic].skipped++;
          continue;
        }

        const outcome = await postImmediateCandidate({
          client,
          topic,
          topicConfig,
          source: candidate.source,
          event: candidate.event,
          scoringResult: candidate.scoringResult,
          routingResult: candidate.routingResult,
          routingMetadata: finalRoutingMetadata,
        });

        const outcomeRoutingMetadata = {
          ...finalRoutingMetadata,
          route: outcome.finalRoute,
          routeReason: outcome.finalReason,
        };

        await saveCurationLog({
          title: candidate.event.title,
          url: candidate.event.url,
          source: candidate.event.sourceName,
          topic: candidate.event.topic,
          status: outcome.finalStatus,
          score: candidate.scoringResult.score,
          breakdown: finalBreakdown,
        }).catch((err) => console.error("Failed to save curation log:", err));

        if (outcome.posted) {
          reserveImmediatePostingSlot(budget, candidate.source, candidate.routingResult.intent, new Date());
          counts[topic].posted++;
        } else {
          if (outcome.finalStatus === ARTICLE_STATUSES.DIGEST_PENDING) {
            await saveArticle(
              candidate.event,
              candidate.scoringResult.score,
              null,
              ARTICLE_STATUSES.DIGEST_PENDING,
              outcome.finalReason,
              undefined,
              undefined,
              null,
              outcomeRoutingMetadata
            );
          } else if (outcome.finalStatus === ARTICLE_STATUSES.SKIPPED_FILTERED) {
            await saveArticle(
              candidate.event,
              candidate.scoringResult.score,
              null,
              ARTICLE_STATUSES.SKIPPED_FILTERED,
              outcome.finalReason,
              undefined,
              undefined,
              null,
              outcomeRoutingMetadata
            );
          }
          counts[topic].skipped++;
        }
      }
    }

    return counts;
  } finally {
    releaseLock();
  }
}
export async function runSinglePoll(client: Client, config: AppConfig): Promise<Record<string, PollTopicCounts>> {
  const startTime = new Date();
  const errors: PollError[] = [];
  
  const counts = await pollNews(client, config, errors);

  // Database Pruning of old skipped/indexed articles
  try {
    const pruneDays = process.env.PRUNE_SKIPPED_DAYS ? parseInt(process.env.PRUNE_SKIPPED_DAYS, 10) : 7;
    const prunedCount = await pruneOldArticles(pruneDays);
    if (prunedCount > 0) {
      console.log(`[Database Cleanup] Pruned ${prunedCount} old skipped/indexed articles.`);
    }
  } catch (pruneError) {
    console.error(`[Database Cleanup] Error pruning old articles:`, pruneError);
  }

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();
  const totalPosted = Object.values(counts).reduce((acc, curr) => acc + curr.posted, 0);
  const totalErrors = errors.length;

  if (totalPosted > 0 || totalErrors > 0) {
    console.log(`=== News Poll Run: ${startTime.toISOString()} (Duration: ${duration}ms) ===`);
    for (const [topic, topicCounts] of Object.entries(counts)) {
      console.log(`[Topic: ${topic}]`);
      const topicSources = config.sources[topic] || [];
      for (const src of topicSources) {
        const srcError = errors.find((e) => e.topic === topic && e.source === src.name);
        if (srcError) {
          console.log(`  - Source: ${src.name}`);
          console.log(`    * ERROR: ${srcError.message}`);
        } else {
          console.log(`  - Source: ${src.name} (OK)`);
        }
      }
      console.log(
        `  - Topic Counts: Checked: ${topicCounts.checked} | New: ${topicCounts.newItems} | Skipped: ${topicCounts.skipped} | Posted: ${topicCounts.posted}`
      );
    }
    console.log(`===========================================`);
  } else {
    console.log(`[News Poll] ${startTime.toISOString()} - All feeds polled successfully. 0 new articles posted.`);
  }

  return counts;
}

/**
 * Scans for open story threads that have been inactive for longer than the configured limit.
 * Archives and locks them in Discord and updates their database status to CLOSED.
 */
export async function archiveInactiveThreads(client: Client, config?: AppConfig): Promise<void> {
  try {
    const inactiveEvents = await getInactiveEvents();
    const limitHours = getThreadInactiveLimitHours();
    const reason = `Event inactive for > ${limitHours} hours`;

    if (inactiveEvents.length > 0) {
      console.log(`[Thread Cleanup] Found ${inactiveEvents.length} inactive event threads to close.`);
    }

    for (const event of inactiveEvents) {
      if (!event.discordThreadId) continue;

      let dbSuccess = false;
      try {
        const threadChannel = await client.channels.fetch(event.discordThreadId);
        if (threadChannel?.isThread()) {
          dbSuccess = await archiveAndLockThread(threadChannel, reason);
        } else {
          // Not a thread or couldn't be fetched as a thread, mark closed in DB
          dbSuccess = true; 
        }
      } catch (discordErr: any) {
        if (discordErr.code === 10003) {
          // Unknown Channel - already deleted
          dbSuccess = true;
        } else {
          console.warn(`[Thread Cleanup] Could not archive thread ${event.discordThreadId} in Discord (permissions issue or API error):`, discordErr.message);
        }
      }

      if (dbSuccess) {
        // Mark the stories as CLOSED in database
        await closeEvent(event.id);
      }
    }

    if (config) {
      await archiveStaleActiveThreads(client, config, limitHours, reason);
    }
  } catch (err) {
    console.error(`[Thread Cleanup] Error during inactive threads archiving:`, err);
  }
}

async function archiveStaleActiveThreads(
  client: Client,
  config: AppConfig,
  limitHours: number,
  reason: string
): Promise<void> {
  const channelIds = new Set(
    Object.values(config.topics)
      .map((topic) => topic.channelId)
      .filter((channelId): channelId is string => Boolean(channelId))
  );

  if (channelIds.size === 0) {
    return;
  }

  const cutoffMs = Date.now() - limitHours * 60 * 60 * 1000;
  let archivedCount = 0;
  const inspectedThreadIds = new Set<string>();

  const guilds = (client as any).guilds?.cache?.values
    ? Array.from((client as any).guilds.cache.values())
    : [];

  for (const guild of guilds) {
    try {
      const active = await (guild as any).channels.fetchActiveThreads();
      for (const thread of active.threads.values()) {
        inspectedThreadIds.add(thread.id);

        if (!channelIds.has(thread.parentId)) {
          continue;
        }

        if (thread.ownerId && client.user?.id && thread.ownerId !== client.user.id) {
          continue;
        }

        if (getThreadActivityTimestamp(thread) >= cutoffMs) {
          continue;
        }

        try {
          if (await archiveAndLockThread(thread, reason)) {
            archivedCount++;
          }
        } catch (threadErr: any) {
          console.warn(
            `[Thread Cleanup] Could not archive active thread ${thread.id} in channel ${thread.parentId}:`,
            threadErr.message ?? threadErr
          );
        }
      }
    } catch (guildErr: any) {
      console.warn(
        `[Thread Cleanup] Could not fetch active guild threads:`,
        guildErr.message ?? guildErr
      );
    }
  }

  for (const channelId of channelIds) {
    try {
      const channel: any = await client.channels.fetch(channelId);
      if (!channel?.threads?.fetchActive) {
        continue;
      }

      const active = await channel.threads.fetchActive();
      for (const thread of active.threads.values()) {
        if (inspectedThreadIds.has(thread.id)) {
          continue;
        }

        if (thread.ownerId && client.user?.id && thread.ownerId !== client.user.id) {
          continue;
        }

        if (getThreadActivityTimestamp(thread) >= cutoffMs) {
          continue;
        }

        try {
          if (await archiveAndLockThread(thread, reason)) {
            archivedCount++;
          }
        } catch (threadErr: any) {
          console.warn(
            `[Thread Cleanup] Could not archive active thread ${thread.id} in channel ${channelId}:`,
            threadErr.message ?? threadErr
          );
        }
      }
    } catch (channelErr: any) {
      console.warn(
        `[Thread Cleanup] Could not fetch active threads for channel ${channelId}:`,
        channelErr.message ?? channelErr
      );
    }
  }

  if (archivedCount > 0) {
    console.log(`[Thread Cleanup] Archived ${archivedCount} stale active bot-owned thread(s) from configured channels.`);
  }
}

let isPolling = false;

/**
 * Starts the cron scheduler for news polling.
 */
export function startScheduler(client: Client, config: AppConfig): cron.ScheduledTask {
  const cronExpression = process.env.POLL_CRON || "*/30 * * * *";

  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid POLL_CRON expression: "${cronExpression}"`);
  }

  console.log(`Scheduling news polling job with cron: "${cronExpression}"`);

  return cron.schedule(cronExpression, async () => {
    if (isPolling) {
      console.warn("[News Poll] Previous poll is still running, skipping this tick.");
      return;
    }

    isPolling = true;
    try {
      await runSinglePoll(client, config);
      await archiveInactiveThreads(client, config);

      // Run periodic LLM review for each topic
      const topics = Object.keys(config.topics);
      for (const topic of topics) {
        try {
          await runPeriodicReview(topic, client);
        } catch (reviewErr) {
          console.error(`[News Poll] Error in runPeriodicReview for topic ${topic}:`, reviewErr);
        }
      }
    } catch (err) {
      console.error(
        `[News Poll] Critical error in polling scheduler run: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      isPolling = false;
    }
  });
}

/**
 * Returns a space-separated string of mentions for bot managers (users & roles) from environment variables.
 */
function getManagerMentions(): string {
  const managerUserIdsStr = process.env.BOT_MANAGER_USER_IDS || "";
  const managerRoleIdsStr = process.env.BOT_MANAGER_ROLE_IDS || "";

  const userIds = managerUserIdsStr.split(",").map(id => id.trim()).filter(id => id.length > 0);
  const roleIds = managerRoleIdsStr.split(",").map(id => id.trim()).filter(id => id.length > 0);

  const mentions: string[] = [];
  for (const id of roleIds) {
    mentions.push(`<@&${id}>`);
  }
  for (const id of userIds) {
    mentions.push(`<@${id}>`);
  }

  return mentions.length > 0 ? mentions.join(" ") : "";
}





