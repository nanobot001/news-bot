import cron from "node-cron";
import type { Client } from "discord.js";
import type { AppConfig } from "../config/loadConfig.js";
import { getPendingDigestArticles, markArticlesAsPostedDigest } from "../storage/articleRepo.js";
import { formatDigestEmbed, postArticleToChannel } from "../bot/postEmbed.js";

// Keep track of active tasks to allow clean reloading
let activeDigestTasks: cron.ScheduledTask[] = [];

/**
 * Executes a digest publish for a given topic and intent.
 */
export async function publishDigestForLane(
  client: Client,
  appConfig: AppConfig,
  topic: string,
  intent: string,
  isDryRun: boolean = false
): Promise<void> {
  const topicConfig = appConfig.topics[topic];
  if (!topicConfig || topicConfig.disabled) {
    return;
  }

  const pendingArticles = await getPendingDigestArticles(topic, intent, 50);
  if (pendingArticles.length === 0) {
    if (isDryRun) {
      console.log(`[Digest] No pending digest items for topic "${topic}" and intent "${intent}".`);
    }
    return;
  }

  if (isDryRun) {
    console.log(`[Digest Dry Run] Would publish digest for "${topic}" (${intent}) with ${pendingArticles.length} items.`);
    return;
  }

  try {
    const embed = formatDigestEmbed(pendingArticles, topicConfig, topic, intent);
    const message = await postArticleToChannel(client, topicConfig.channelId, embed);

    const ids = pendingArticles.map(a => a.id);
    await markArticlesAsPostedDigest(ids, topic, message.id, message.channelId);

    console.log(`[Digest] Published digest for topic "${topic}" (${intent}) with ${pendingArticles.length} items.`);
  } catch (error) {
    console.error(`[Digest Error] Failed to publish digest for topic "${topic}" (${intent}):`, error);
  }
}

/**
 * Cancels all currently running digest schedulers.
 */
function clearDigestSchedulers() {
  for (const task of activeDigestTasks) {
    task.stop();
  }
  activeDigestTasks = [];
}

/**
 * Initializes and starts all digest schedules configured in the appConfig.
 */
export function startDigestSchedulers(client: Client, appConfig: AppConfig): void {
  clearDigestSchedulers();

  for (const [topic, config] of Object.entries(appConfig.topics)) {
    if (config.disabled || !config.intentRouting) {
      continue;
    }

    for (const [intent, policy] of Object.entries(config.intentRouting)) {
      if (policy && policy.digestSchedule) {
        if (!cron.validate(policy.digestSchedule)) {
          console.error(`[Digest Error] Invalid digest schedule for topic "${topic}" (${intent}): "${policy.digestSchedule}"`);
          continue;
        }

        console.log(`[Digest] Scheduling digest for "${topic}" (${intent}) with cron: "${policy.digestSchedule}"`);
        const task = cron.schedule(policy.digestSchedule, async () => {
          try {
            await publishDigestForLane(client, appConfig, topic, intent);
          } catch (error) {
            console.error(`[Digest] Uncaught error in scheduled digest run for "${topic}" (${intent}):`, error);
          }
        });
        
        activeDigestTasks.push(task);
      }
    }
  }
}
