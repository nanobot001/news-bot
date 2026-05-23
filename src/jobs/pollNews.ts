import cron from "node-cron";
import type { Client } from "discord.js";
import type { AppConfig } from "../config/loadConfig.js";
import { fetchFeedItems } from "../ingestion/fetchFeeds.js";
import { normalizeRssItem } from "../normalization/normalizeRssItem.js";
import { checkDuplicate } from "../processing/dedupe.js";
import { scoreArticle } from "../processing/scoreArticle.js";
import { filterArticle } from "../processing/filterArticle.js";
import { saveArticle } from "../storage/articleRepo.js";
import { formatArticleEmbed, postArticleToChannel } from "../bot/postEmbed.js";

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
    if (!topicConfig) {
      continue;
    }
    const sources = config.sources[topic] || [];

    for (const source of sources) {
      try {
        const result = await fetchFeedItems(source);
        for (const item of result.items) {
          counts[topic].checked++;
          const event = normalizeRssItem({ topic, source, item });
          const dedupeResult = await checkDuplicate(event);

          if (dedupeResult.isDuplicate) {
            counts[topic].skipped++;
            continue;
          }

          counts[topic].newItems++;
          const scoringResult = scoreArticle({
            event,
            keywords: topicConfig.keywords,
            blockedTerms: topicConfig.blockedTerms,
            trustedSource: source.trusted,
          });

          const filteringResult = filterArticle({
            score: scoringResult.score,
            threshold: topicConfig.postThreshold,
            isDuplicate: false,
          });

          const isDryRun = forceDryRun || process.env.DRY_RUN === "true";

          if (filteringResult.shouldPost) {
            counts[topic].eligible!++;
            if (isDryRun) {
              console.log(`[Dry Run] Would post article: "${event.title}" to channel: ${topicConfig.channelId}`);
              counts[topic].skipped++;
            } else {
              const embed = formatArticleEmbed({ event, score: scoringResult.score });
              await postArticleToChannel(client, topicConfig.channelId, embed);
              await saveArticle(event, scoringResult.score, new Date());
              counts[topic].posted++;
            }
          } else {
            if (!isDryRun) {
              await saveArticle(event, scoringResult.score);
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
}

/**
 * Runs a poll run once, then logs the results using the log-on-demand strategy.
 */
export async function runSinglePoll(client: Client, config: AppConfig): Promise<Record<string, PollTopicCounts>> {
  const startTime = new Date();
  const errors: PollError[] = [];
  
  const counts = await pollNews(client, config, errors);
  
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
    } catch (err) {
      console.error(
        `[News Poll] Critical error in polling scheduler run: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      isPolling = false;
    }
  });
}
