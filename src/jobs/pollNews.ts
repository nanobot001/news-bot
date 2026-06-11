import cron from "node-cron";
import type { Client } from "discord.js";
import type { AppConfig } from "../config/loadConfig.js";
import { fetchFeedItems } from "../ingestion/fetchFeeds.js";
import { normalizeRssItem } from "../normalization/normalizeRssItem.js";
import { checkDuplicate } from "../processing/dedupe.js";
import { scoreArticle } from "../processing/scoreArticle.js";
import { filterArticle } from "../processing/filterArticle.js";
import { saveArticle, pruneOldArticles, saveCurationLog, getActiveAnchors, setStoryThreadId, updateLastStoryAddedAt, getInactiveStoryAnchors, closeStoryAnchor } from "../storage/articleRepo.js";
import { ARTICLE_STATUSES, type ArticleStatus, routeToPendingStatus } from "../storage/articleStatus.js";
import { formatArticleEmbed, postArticleToChannel } from "../bot/postEmbed.js";
import { calculateJaccardSimilarity, cleanThreadTitle } from "../processing/similarity.js";
import { classifyContentIntent, decideContentRoute } from "../processing/contentRouting.js";
import { acquireLock, releaseLock } from "../utils/lock.js";
import { decodeGoogleNewsUrl } from "../utils/googleNewsResolver.js";
import { scrapeOgImage } from "../utils/ogImageScraper.js";

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

    for (const source of sources) {
      try {
        const result = await fetchFeedItems(source);
        for (const item of result.items) {
          counts[topic].checked++;
          const event = normalizeRssItem({ topic, source, item });

          // Pre-filter: If the article publication date is older than DEDUPE_WINDOW_DAYS, ignore it entirely without database hits/writes.
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

          // Resolve Google News URLs before scoring and persisting
          if (event.url.startsWith("https://news.google.com")) {
            try {
              const decodedUrl = await decodeGoogleNewsUrl(event.url);
              if (decodedUrl && decodedUrl !== event.url) {
                event.url = decodedUrl;
                // Re-run deduplication check on the resolved canonical URL
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
          const routingResult = {
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

          const isDryRun = forceDryRun || process.env.DRY_RUN === "true";
          const curationStatus = determineCurationStatus(
            filteringResult.shouldPost,
            routingResult.route,
            scoringResult.reasons,
            filteringResult.reasons
          );

          if (!isDryRun) {
            await saveCurationLog({
              title: event.title,
              url: event.url,
              source: event.sourceName,
              topic: event.topic,
              status: curationStatus,
              score: scoringResult.score,
              breakdown: curationBreakdown,
            }).catch((err) => {
              console.error(`Failed to save curation log:`, err);
            });
          }

          if (routingResult.route === "immediate_post" || routingResult.route === "thread_only") {
            counts[topic].eligible!++;
            if (isDryRun) {
              console.log(`[Dry Run] Would route article: "${event.title}" as ${routingResult.route}`);
              counts[topic].skipped++;
            } else {
              // Scrape the OG image from the resolved URL if no image is present
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
              // 1. Fetch active story anchors for the topic
              const activeAnchors = await getActiveAnchors(topic);
              let bestAnchor: any = null;
              let bestScore = 0;
              const similarityThreshold = process.env.SIMILARITY_THRESHOLD ? parseFloat(process.env.SIMILARITY_THRESHOLD) : 0.25;

              for (const anchor of activeAnchors) {
                const jaccardScore = calculateJaccardSimilarity(event.title, anchor.title);
                if (jaccardScore > bestScore) {
                  bestScore = jaccardScore;
                  bestAnchor = anchor;
                }
              }

              // 2. If similar story anchor found, merge/post into its thread
              if (bestAnchor && bestScore >= similarityThreshold) {
                let threadId = bestAnchor.storyThreadId;

                // 2a. Lazy create thread on parent message if it doesn't exist
                if (!threadId && bestAnchor.discordChannelId && bestAnchor.discordMessageId) {
                  try {
                    const anchorChannel = await client.channels.fetch(bestAnchor.discordChannelId);
                    if (anchorChannel?.isTextBased()) {
                      const anchorMsg = await anchorChannel.messages.fetch(bestAnchor.discordMessageId);
                      if (anchorMsg) {
                        const threadTitle = cleanThreadTitle(bestAnchor.title);
                        let thread: any;
                        try {
                          thread = await anchorMsg.startThread({
                            name: threadTitle,
                            autoArchiveDuration: 1440
                          });
                        } catch (startErr: any) {
                          console.warn("[PollNews] startThread failed, fetching existing thread by ID:", startErr);
                          thread = await client.channels.fetch(anchorMsg.id).catch(() => null);
                          if (!thread) {
                            throw startErr;
                          }
                        }
                        threadId = thread.id;
                        await setStoryThreadId(bestAnchor.id, bestAnchor.topic, thread.id);

                        // Ping managers in the new thread
                        const mentions = getManagerMentions();
                        if (mentions) {
                          await (thread as any).send({
                            content: `🧵 New story thread created. Alert: ${mentions}`
                          });
                        }

                        // Auto-add configured managers to the thread so they join automatically
                        const managerUserIdsStr = process.env.BOT_MANAGER_USER_IDS || "";
                        const managerUserIds = managerUserIdsStr.split(",").map(id => id.trim()).filter(id => id.length > 0);
                        for (const uId of managerUserIds) {
                          try {
                            await thread.members.add(uId);
                          } catch (memberErr) {
                            console.error(`Failed to auto-add user ${uId} to thread:`, memberErr);
                          }
                        }
                      }
                    }
                  } catch (threadErr) {
                    console.error("Failed to lazy create thread on anchor message:", threadErr);
                  }
                }

                // 2b. Post child embed inside thread
                if (threadId) {
                  try {
                    const threadChannel = await client.channels.fetch(threadId);
                    if (threadChannel?.isTextBased()) {
                      const embed = formatArticleEmbed({ event, score: scoringResult.score, emoji: topicConfig.emoji, intent: routingResult.intent });
                      const threadMsg = await (threadChannel as any).send({ embeds: [embed] });

                      // Save as RELATED_COVERAGE child
                      await saveArticle(
                        event,
                        scoringResult.score,
                        new Date(),
                        ARTICLE_STATUSES.RELATED_COVERAGE,
                        `Clustered automatically via similarity check (Jaccard: ${bestScore.toFixed(2)})`,
                        threadMsg?.id,
                        threadId,
                        bestAnchor.id,
                        bestAnchor.topic,
                        null,
                        null,
                        routingMetadata
                      );

                      // Update anchor's lastStoryAddedAt
                      await updateLastStoryAddedAt(bestAnchor.id, bestAnchor.topic, new Date());
                      counts[topic].posted++;
                      continue;
                    }
                  } catch (postErr) {
                    console.error("Failed to post child article inside thread, falling back to standalone:", postErr);
                  }
                }
              }

              if (routingResult.route === "thread_only") {
                await saveArticle(
                  event,
                  scoringResult.score,
                  null,
                  ARTICLE_STATUSES.DIGEST_PENDING,
                  "No related active story thread found for thread-only discussion item",
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  {
                    ...routingMetadata,
                    route: "digest_pending",
                    routeReason: "No related active story thread found for thread-only discussion item",
                  }
                );
                counts[topic].skipped++;
                continue;
              }

              // 3. Fallback or standard post: post as standalone article
              const embed = formatArticleEmbed({ event, score: scoringResult.score, emoji: topicConfig.emoji, intent: routingResult.intent });
              const message = await postArticleToChannel(client, topicConfig.channelId, embed);
              await saveArticle(
                event,
                scoringResult.score,
                new Date(),
                ARTICLE_STATUSES.POSTED,
                undefined,
                message?.id,
                message?.channelId,
                undefined,
                undefined,
                undefined,
                undefined,
                routingMetadata
              );
              counts[topic].posted++;
            }
          } else if (routingResult.route === "digest_pending" || routingResult.route === "review_pending" || routingResult.route === "skip") {
            if (!isDryRun) {
              await saveArticle(
                event,
                scoringResult.score,
                null,
                routeToPendingStatus(routingResult.route, filteringResult.reasons),
                routingResult.reason,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                routingMetadata
              );
            } else {
              console.log(`[Dry Run] Would save article with route ${routingResult.route}: "${event.title}"`);
            }
            counts[topic].skipped++;
          } else {
            if (!isDryRun) {
              await saveArticle(
                event,
                scoringResult.score,
                null,
                classifySkipStatus(filteringResult.reasons),
                filteringResult.reasons.join("; "),
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                routingMetadata
              );
            } else {
              console.log(`[Dry Run] Would save article (unposted) with score: ${scoringResult.score}: "${event.title}"`);
            }
            counts[topic].skipped++;
          }
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
  }

    return counts;
  } finally {
    releaseLock();
  }
}

/**
 * Runs a poll run once, then logs the results using the log-on-demand strategy.
 */
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
 * Scans for open threads that have been inactive for more than 24 hours.
 * Archives and locks them in Discord and updates their database status to CLOSED.
 */
export async function archiveInactiveThreads(client: Client): Promise<void> {
  try {
    const inactiveAnchors = await getInactiveStoryAnchors();
    if (inactiveAnchors.length === 0) {
      return;
    }

    const limitHours = process.env.THREAD_INACTIVE_LIMIT_HOURS 
      ? parseFloat(process.env.THREAD_INACTIVE_LIMIT_HOURS) 
      : 4;
    const reason = `Story inactive for > ${limitHours} hours`;

    console.log(`[Thread Cleanup] Found ${inactiveAnchors.length} inactive story threads to close.`);

    for (const anchor of inactiveAnchors) {
      if (!anchor.storyThreadId) continue;

      try {
        const threadChannel = await client.channels.fetch(anchor.storyThreadId);
        if (threadChannel?.isThread()) {
          // Lock and archive the thread
          await threadChannel.setArchived(true, reason);
          await threadChannel.setLocked(true, reason);
          console.log(`[Thread Cleanup] Archived & locked thread: "${threadChannel.name}" (${threadChannel.id})`);
        }
      } catch (discordErr) {
        console.warn(`[Thread Cleanup] Could not archive thread ${anchor.storyThreadId} in Discord (might already be deleted/archived):`, discordErr);
      }

      // Mark the story anchor as CLOSED in database
      await closeStoryAnchor(anchor.id, anchor.topic);
    }
  } catch (err) {
    console.error(`[Thread Cleanup] Error during inactive threads archiving:`, err);
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
      await archiveInactiveThreads(client);
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
