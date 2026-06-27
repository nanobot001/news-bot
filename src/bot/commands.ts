import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type Client,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction
} from "discord.js";
import { type AppConfig, type IntentRoutingPolicy, reloadAppConfig, saveTopicsConfig, saveSourcesConfig } from "../config/loadConfig.js";
import { buildPostingControlBudget, calculatePostingPriority, evaluatePostingControls, formatPostingControlsSummary, reserveImmediatePostingSlot } from "../processing/postingControls.js";
import { getArticlesForTopic, getFavorites, deleteFavoriteById, getCurationLogs, saveArticle } from "../storage/articleRepo.js";
import { pollNews, classifySkipStatus } from "../jobs/pollNews.js";
import { startDigestSchedulers, publishDigestForLane } from "../jobs/digestPublisher.js";
import { prisma } from "../storage/prismaClient.js";
import { formatArticleStatus, ARTICLE_STATUSES } from "../storage/articleStatus.js";
import { isBotManager } from "./auth.js";
import { scoreArticle } from "../processing/scoreArticle.js";
import { filterArticle } from "../processing/filterArticle.js";
import { classifyContentIntent, decideContentRoute } from "../processing/contentRouting.js";
import type { ContentRoutingResult } from "../processing/contentRouting.js";
import { formatArticleEmbed, postArticleToChannel } from "./postEmbed.js";
import type { NormalizedEvent } from "../normalization/normalizedEvent.js";
import { cleanThreadTitle } from "../processing/similarity.js";
import { runPeriodicReview } from "../services/llmReview.js";
import { setEventThreadAndIndex } from "../storage/storyRepo.js";
import { updateEventIndex, generateIndexEmbed } from "./indexManager.js";

export const removeArticleCommand = new ContextMenuCommandBuilder().setName("Remove Article").setType(ApplicationCommandType.Message);

export const mergeToThreadCommand = new ContextMenuCommandBuilder()
  .setName("Merge to Thread")
  .setType(ApplicationCommandType.Message);

export const removeFromThreadCommand = new ContextMenuCommandBuilder()
  .setName("Remove from Thread")
  .setType(ApplicationCommandType.Message);

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_SAFE_MESSAGE_LIMIT = 1900;

function chunkLines(header: string, lines: string[], limit = DISCORD_SAFE_MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  let current = header;

  for (const line of lines) {
    const nextLine = `${line}\n`;
    if (current.length + nextLine.length > limit && current !== header) {
      chunks.push(current.trimEnd());
      current = "";
    }

    if (nextLine.length > limit) {
      const available = Math.max(limit - 20, 1);
      chunks.push(`${nextLine.slice(0, available).trimEnd()}\n...`);
      continue;
    }

    current += nextLine;
  }

  if (current.trim().length > 0) {
    chunks.push(current.trimEnd());
  }

  return chunks.map(chunk => chunk.length > DISCORD_MESSAGE_LIMIT ? chunk.slice(0, DISCORD_MESSAGE_LIMIT) : chunk);
}

function formatIntentPolicy(intent: string, policy: IntentRoutingPolicy): string {
  const details = [`route: \`${policy.route}\``];
  if (policy.postThreshold !== undefined) {
    details.push(`threshold: \`${policy.postThreshold}\``);
  }
  if (policy.digestEligible !== undefined) {
    details.push(`digest: \`${policy.digestEligible ? "yes" : "no"}\``);
  }
  if (policy.digestSchedule) {
    details.push(`schedule: \`${policy.digestSchedule}\``);
  }
  return `\`${intent}\` -> ${details.join(", ")}`;
}

function formatIntentPolicies(intentRouting: AppConfig["topics"][string]["intentRouting"]): string {
  if (!intentRouting || Object.keys(intentRouting).length === 0) {
    return "*Default routing*";
  }

  return Object.entries(intentRouting)
    .map(([intent, policy]) => formatIntentPolicy(intent, policy))
    .join("; ");
}

function getSourceIntentBreakdown(sources: AppConfig["sources"][string]): string {
  if (sources.length === 0) {
    return "*No sources*";
  }

  const counts = new Map<string, number>();
  for (const source of sources) {
    const intent = source.intentDefault ?? "auto";
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([intent, count]) => `\`${intent}\`: ${count}`)
    .join(", ");
}

function formatSourceIntentDetails(source: AppConfig["sources"][string][number]): string {
  const details = [source.trusted ? "trusted" : "untrusted"];
  details.push(`intent: \`${source.intentDefault ?? "auto"}\``);
  if (source.routeHint) {
    details.push(`route hint: \`${source.routeHint}\``);
  }
  if (source.tier !== undefined) {
    details.push(`tier: \`${source.tier}\``);
  }
  return details.join(", ");
}



export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the news bot is running.");

export const testfeedCommand = new SlashCommandBuilder()
  .setName("testfeed")
  .setDescription("Perform a dry-run check of feeds for a specific topic.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The topic to test")
      .setRequired(true)
      .setAutocomplete(true)
  );

export const lastpostsCommand = new SlashCommandBuilder()
  .setName("lastposts")
  .setDescription("Show recently ingested articles for a specific topic.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The topic to retrieve")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName("status")
      .setDescription("Filter by status (default: posted)")
      .setRequired(false)
      .addChoices(
        { name: "Posted Only", value: "posted" },
        { name: "Unposted/Skipped", value: "unposted" }
      )
  )
  .addIntegerOption(option =>
    option.setName("hours")
      .setDescription("Limit results to articles ingested in the last N hours")
      .setRequired(false)
  );

export const reloadconfigCommand = new SlashCommandBuilder()
  .setName("reload-config")
  .setDescription("Reload configuration files without restarting the bot.");

export const testdigestCommand = new SlashCommandBuilder()
  .setName("testdigest")
  .setDescription("Generate a dry-run or immediate digest for a specific topic and intent lane.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The topic to generate a digest for")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName("intent")
      .setDescription("The intent lane to generate a digest for")
      .setRequired(true)
  )
  .addBooleanOption(option =>
    option.setName("post")
      .setDescription("Whether to actually post it to Discord and mark articles as posted (default: false)")
      .setRequired(false)
  );

export const refreshCommand = new SlashCommandBuilder()
  .setName("refresh")
  .setDescription("Run a live feed check and post eligible articles to Discord.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The specific topic to refresh (optional)")
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addIntegerOption(option =>
    option.setName("hours")
      .setDescription("Re-score and preview unposted articles from the last N hours (optional)")
      .setRequired(false)
  );

export const statsCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show indexing and publishing metrics from the database.");

export const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search the database of ingested news articles.")
  .addStringOption(option =>
    option.setName("query")
      .setDescription("The search term to look for in article titles")
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("Restrict search to a specific topic (optional)")
      .setRequired(false)
      .setAutocomplete(true)
  );

export const topicsCommand = new SlashCommandBuilder()
  .setName("topics")
  .setDescription("List all active configured topics and their settings.");

export const sourcesCommand = new SlashCommandBuilder()
  .setName("sources")
  .setDescription("List RSS feed sources configured for the bot.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("Limit to a specific topic (optional)")
      .setRequired(false)
      .setAutocomplete(true)
  );

export const favoritesCommand = new SlashCommandBuilder()
  .setName("favorites")
  .setDescription("Recall your personal favorited news articles.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("Filter by a specific topic (optional)")
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName("query")
      .setDescription("Search by title, source, or URL text (optional)")
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName("source")
      .setDescription("Filter by news source name (optional)")
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName("since")
      .setDescription("Filter window (e.g. 7d, 30d, or YYYY-MM-DD) (optional)")
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option.setName("limit")
      .setDescription("Maximum number of results to return (optional)")
      .setRequired(false)
  );

export const unfavoriteCommand = new SlashCommandBuilder()
  .setName("unfavorite")
  .setDescription("Remove an article from your personal favorites.")
  .addStringOption(option =>
    option.setName("article")
      .setDescription("The favorited article to remove (supports autocomplete search)")
      .setRequired(true)
      .setAutocomplete(true)
  );

export const auditCommand = new SlashCommandBuilder()
  .setName("audit")
  .setDescription("View recent curation and evaluation logs for a specific topic.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The topic to audit")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addIntegerOption(option =>
    option.setName("limit")
      .setDescription("Number of logs to retrieve (default: 10, max: 100)")
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName("query")
      .setDescription("Search query for article title (optional)")
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName("source")
      .setDescription("Filter by news source name (optional)")
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName("status")
      .setDescription("Filter by curation status (optional)")
      .setRequired(false)
      .addChoices(
        { name: "POSTED", value: "POSTED" },
        { name: "DIGEST_PENDING", value: "DIGEST_PENDING" },
        { name: "REVIEW_PENDING", value: "REVIEW_PENDING" },
        { name: "POSTED_DIGEST", value: "POSTED_DIGEST" },
        { name: "RELATED_COVERAGE", value: "RELATED_COVERAGE" },
        { name: "SKIPPED_INTENT", value: "SKIPPED_INTENT" },
        { name: "SKIPPED_THRESHOLD", value: "SKIPPED_THRESHOLD" },
        { name: "SKIPPED_BLOCKED", value: "SKIPPED_BLOCKED" },
        { name: "DEFERRED_COOLDOWN", value: "DEFERRED_COOLDOWN" },
        { name: "REMOVED", value: "REMOVED" }
      )
  );

export const topicCommand = new SlashCommandBuilder()
  .setName("topic")
  .setDescription("Manage topics for the news bot (Bot Manager only)")
  .addSubcommand(sub =>
    sub.setName("list")
      .setDescription("List all topics, including disabled ones")
  )
  .addSubcommand(sub =>
    sub.setName("view")
      .setDescription("View details of a specific topic config")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to view")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("create")
      .setDescription("Create a new news topic")
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name of the new topic (lowercase, alphanumeric, hyphens only)")
          .setRequired(true)
      )
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("The Discord channel to post articles to")
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("threshold")
          .setDescription("The minimum score required to post (default: 20)")
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName("emoji")
          .setDescription("The prefix emoji for the topic notifications (optional)")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName("set-channel")
      .setDescription("Set the posting channel for a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to update")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("The new Discord channel to post to")
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("set-threshold")
      .setDescription("Set the posting threshold for a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to update")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addIntegerOption(option =>
        option.setName("threshold")
          .setDescription("The new minimum score required to post")
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("set-emoji")
      .setDescription("Set or clear the emoji prefix for a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to update")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName("emoji")
          .setDescription("The new emoji prefix, or 'clear' to remove")
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("disable")
      .setDescription("Toggle polling state for a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to disable/enable")
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

export const sourceCommand = new SlashCommandBuilder()
  .setName("source")
  .setDescription("Manage news sources for the news bot (Bot Manager only)")
  .addSubcommand(sub =>
    sub.setName("list")
      .setDescription("List RSS feed sources configured for a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to view sources for")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("add")
      .setDescription("Add an RSS feed source to a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to add the source to")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name of the source (e.g. TechCrunch)")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("url")
          .setDescription("The RSS feed URL")
          .setRequired(true)
      )
      .addBooleanOption(option =>
        option.setName("trusted")
          .setDescription("Whether this is a trusted source (+35 score bonus)")
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("remove")
      .setDescription("Remove an RSS feed source from a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic to remove the source from")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName("name")
          .setDescription("The name of the source to remove")
          .setRequired(true)
      )
  );

export const keywordCommand = new SlashCommandBuilder()
  .setName("keyword")
  .setDescription("Manage topic keywords (Bot Manager only for add/remove)")
  .addSubcommand(sub =>
    sub.setName("view")
      .setDescription("View keywords for a topic")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic(s) to view (comma-separated)")
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("add")
      .setDescription("Add a keyword to a topic (Bot Manager only)")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic(s) to add keywords to (comma-separated)")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName("keyword")
          .setDescription("The keyword to add")
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName("type")
          .setDescription("Standard, Location, or Negative keyword (default: standard)")
          .setRequired(false)
          .addChoices(
            { name: "Standard", value: "standard" },
            { name: "Location", value: "location" },
            { name: "Negative", value: "negative" }
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName("remove")
      .setDescription("Remove a keyword from a topic (Bot Manager only)")
      .addStringOption(option =>
        option.setName("topic")
          .setDescription("The topic(s) to remove keywords from (comma-separated)")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName("keyword")
          .setDescription("The keyword to remove")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName("type")
          .setDescription("Standard, Location, or Negative keyword (default: standard)")
          .setRequired(false)
          .addChoices(
            { name: "Standard", value: "standard" },
            { name: "Location", value: "location" },
            { name: "Negative", value: "negative" }
          )
      )
  );

export function getCommandRegistrationPayloads(): any[] {
  return [
    pingCommand.toJSON(),
    testfeedCommand.toJSON(),
    lastpostsCommand.toJSON(),
    reloadconfigCommand.toJSON(),
    testdigestCommand.toJSON(),
    refreshCommand.toJSON(),
    statsCommand.toJSON(),
    searchCommand.toJSON(),
    topicsCommand.toJSON(),
    sourcesCommand.toJSON(),
    favoritesCommand.toJSON(),
    unfavoriteCommand.toJSON(),
    auditCommand.toJSON(),
    topicCommand.toJSON(),
    sourceCommand.toJSON(),
    keywordCommand.toJSON(),
    removeArticleCommand.toJSON(),
    mergeToThreadCommand.toJSON(),
    removeFromThreadCommand.toJSON()
  ];
}

export async function handlePingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: "Pong. News bot shell is running.",
    ephemeral: true
  });
}

export async function handleTestfeedCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const topic = interaction.options.getString("topic", true);

  if (!appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const errorsList: Array<{ topic: string; source: string; message: string }> = [];
    const countsMap = await pollNews(client, appConfig, errorsList, topic, true);
    const topicCounts = countsMap[topic] || { checked: 0, newItems: 0, skipped: 0, posted: 0, eligible: 0 };
    const numFeeds = (appConfig.sources[topic] || []).length;

    let responseText = `**Diagnostic Test Run for Topic: "${topic}"**\n`;
    responseText += `- Posting controls: ${formatPostingControlsSummary(appConfig.topics[topic])}\n`;
    responseText += `- Feeds checked: ${numFeeds}\n`;
    responseText += `- Items found in feed: ${topicCounts.checked}\n`;
    responseText += `- New items (not in database): ${topicCounts.newItems}\n`;
    responseText += `- Immediate candidates: ${topicCounts.eligible ?? 0}\n`;
    responseText += `- Posted immediately: ${topicCounts.posted}\n`;
    responseText += `- Deferred or skipped: ${topicCounts.skipped}\n`;

    if (errorsList.length > 0) {
      responseText += `\n**Errors encountered during check:**\n`;
      for (const err of errorsList) {
        const errorLine = `- Source *${err.source}*: ${err.message}\n`;
        if (responseText.length + errorLine.length > 1950) {
          responseText += `\n*...and ${errorsList.length - errorsList.indexOf(err)} more errors (truncated due to Discord limit).*`;
          break;
        }
        responseText += errorLine;
      }
    }

    await interaction.editReply({ content: responseText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to run diagnostic test: ${msg}`
    });
  }
}

export async function handleLastpostsCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  const topic = interaction.options.getString("topic", true);
  const status = (interaction.options.getString("status") ?? "posted") as "posted" | "unposted";
  const hours = interaction.options.getInteger("hours");

  if (!appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    const articles = await getArticlesForTopic(topic, status, hours, 10);

    const hoursStr = hours ? ` (last ${hours} hours)` : "";
    if (articles.length === 0) {
      await interaction.editReply({
        content: `No recently ${status} articles found for topic: "${topic}"${hoursStr}.`
      });
      return;
    }

    const titlePrefix = status === "posted" ? "posted" : "ingested (unposted)";
    let responseText = `**Recently ${titlePrefix} articles for topic: "${topic}"${hoursStr}**\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const timeStr = status === "posted" && art.postedAt
        ? `<t:${Math.floor(art.postedAt.getTime() / 1000)}:R>`
        : `<t:${Math.floor(art.firstSeenAt.getTime() / 1000)}:R>`;

      const timeLabel = status === "posted" ? "Posted" : "Ingested";
      const link = art.url ? `[${art.title}](${art.url})` : art.title;
      const scoreStr = art.score !== null ? `(Score: ${art.score})` : "";

      let line = "";
      if (status === "posted") {
        line = `${i + 1}. ✅ ${link} ${scoreStr} - ${timeLabel} ${timeStr}\n`;
      } else {
        const statusText = formatArticleStatus(art.status, art.postedAt, art.statusReason);
        line = `${i + 1}. ❌ [${statusText}] ${link} ${scoreStr} - ${timeLabel} ${timeStr}\n`;
      }

      if (responseText.length + line.length > 1950) {
        responseText += `\n*...and ${articles.length - i} more items (truncated).*`;
        break;
      }
      responseText += line;
    }

    await interaction.editReply({ content: responseText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to fetch recently ${status} articles: ${msg}`
    });
  }
}

export async function handleReloadconfigCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    await reloadAppConfig(appConfig);
    startDigestSchedulers(client, appConfig);
    const numTopics = Object.keys(appConfig.topics).length;
    const numSources = Object.values(appConfig.sources).flat().length;
    await interaction.editReply({
      content: `Successfully reloaded configuration. Loaded ${numTopics} topics and ${numSources} sources.`
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to reload configuration: ${msg}`
    });
  }
}

export async function handleTestdigestCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const topic = interaction.options.getString("topic", true);
  const intent = interaction.options.getString("intent", true);
  const post = interaction.options.getBoolean("post") ?? false;

  if (!appConfig.topics[topic]) {
    await interaction.reply({ content: `Unknown topic: "${topic}"`, ephemeral: true });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    await publishDigestForLane(client, appConfig, topic, intent, !post);
    await interaction.editReply({
      content: `Digest execution complete for "${topic}" (${intent}). ${post ? 'Posted to channel.' : 'Dry-run only, check console for details.'}`
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: `Failed to execute digest: ${msg}` });
  }
}

export async function handleRefreshCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
  appConfig: AppConfig
): Promise<void> {
  const topic = interaction.options.getString("topic");
  const hours = interaction.options.getInteger("hours");

  if (hours !== null) {
    if (!topic) {
      await interaction.reply({
        content: "❌ **Error:** You must specify a `topic` when using the `hours` option.",
        ephemeral: true
      });
      return;
    }
    if (hours <= 0) {
      await interaction.reply({
        content: "❌ **Error:** `hours` must be a positive integer.",
        ephemeral: true
      });
      return;
    }
    if (hours > 72) {
      await interaction.reply({
        content: "❌ **Error:** The lookback window cannot exceed 72 hours.",
        ephemeral: true
      });
      return;
    }
  }

  if (topic && !appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    if (hours !== null && topic) {
      // Preview-only historical rescore that uses the same posting controls without posting to Discord.
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      const articles = await prisma.article.findMany({
        where: {
          topic,
          firstSeenAt: { gte: cutoff }
        }
      });

      const topicConfig = appConfig.topics[topic];
      const sources = appConfig.sources[topic] || [];
      const postedArticles = await prisma.article.findMany({
        where: { topic, status: ARTICLE_STATUSES.POSTED }
      });
      const budget = buildPostingControlBudget(postedArticles);

      type PreviewCandidate = {
        article: typeof articles[number];
        event: NormalizedEvent;
        sourceConfig: (typeof sources)[number] | undefined;
        scoringResult: ReturnType<typeof scoreArticle>;
        routingResult: ContentRoutingResult;
        priority: number;
      };

      const candidates: PreviewCandidate[] = [];
      let checked = 0;
      let alreadyPosted = 0;
      let skipped = 0;

      for (const article of articles) {
        checked++;
        if (article.postedAt !== null || article.status === "POSTED") {
          alreadyPosted++;
          continue;
        }

        let raw: any = null;
        let summary: string | undefined;
        if (article.rawJson) {
          try {
            raw = JSON.parse(article.rawJson);
            summary = raw.contentSnippet ?? raw.content ?? undefined;
          } catch (_) {}
        }

        const event: NormalizedEvent = {
          id: article.id,
          type: "news.article",
          topic: article.topic,
          title: article.title,
          url: article.url ?? "",
          sourceName: article.source,
          publishedAt: article.publishedAt ? article.publishedAt.toISOString() : undefined,
          summary,
          raw
        };

        const sourceConfig = sources.find((s) => s.name.toLowerCase() === article.source.toLowerCase());
        const trustedSource = sourceConfig ? sourceConfig.trusted : false;
        const scoringResult = scoreArticle({
          event,
          keywords: topicConfig.keywords,
          locationKeywords: topicConfig.locationKeywords || [],
          blockedTerms: topicConfig.blockedTerms || [],
          trustedSource
        });

        const intentClassification = classifyContentIntent(event, sourceConfig ?? { name: article.source, url: "", trusted: trustedSource });
        const routingThreshold = topicConfig.intentRouting?.[intentClassification.intent]?.postThreshold ?? topicConfig.postThreshold;
        const filteringResult = filterArticle({
          score: scoringResult.score,
          threshold: routingThreshold,
          isDuplicate: false,
          publishedAt: event.publishedAt,
          maxAgeHours: hours
        });

        if (!filteringResult.shouldPost) {
          skipped++;
          continue;
        }

        const routingResult = {
          ...intentClassification,
          ...decideContentRoute({
            classification: intentClassification,
            topicConfig,
            source: sourceConfig ?? { name: article.source, url: "", trusted: trustedSource },
            score: scoringResult.score,
            filterAllowsPost: filteringResult.shouldPost,
            filterReasons: filteringResult.reasons,
          }),
        };

        candidates.push({
          article,
          event,
          sourceConfig,
          scoringResult,
          routingResult,
          priority: calculatePostingPriority({
            score: scoringResult.score,
            source: sourceConfig ?? { name: article.source, url: "", trusted: trustedSource },
            routingResult,
            title: event.title,
            summary: event.summary,
            publishedAt: event.publishedAt,
            topic,
          }),
        });
      }

      candidates.sort((left, right) => right.priority - left.priority);
      let previewPosted = 0;
      let previewDigest = 0;

      for (const candidate of candidates) {
        const source = candidate.sourceConfig ?? { name: candidate.article.source, url: "", trusted: false };
        const controlDecision = evaluatePostingControls({
          topic,
          source,
          topicConfig,
          routingResult: candidate.routingResult,
          score: candidate.scoringResult.score,
          title: candidate.event.title,
          summary: candidate.event.summary,
          publishedAt: candidate.event.publishedAt,
          budget,
        });

        if (controlDecision.status === "POSTED") {
          previewPosted++;
          reserveImmediatePostingSlot(budget, source, candidate.routingResult.intent, new Date());
        } else {
          previewDigest++;
        }
      }

      let responseText = `**Historical Rescore Preview (Topic: ${topic}, Window: ${hours}h)**\n\n`;
      responseText += `- Posting controls: ${formatPostingControlsSummary(topicConfig)}\n`;
      responseText += `- Articles Checked: ${checked}\n`;
      responseText += `- Already Posted: ${alreadyPosted}\n`;
      responseText += `- Would Post Now: ${previewPosted}\n`;
      responseText += `- Would Route To Digest/Review: ${previewDigest}\n`;
      responseText += `- Still Skipped By Filter: ${skipped}\n`;

      await interaction.editReply({ content: responseText });
    } else {
      // Standard polling live refresh
      const errorsList: Array<{ topic: string; source: string; message: string }> = [];
      const countsMap = await pollNews(client, appConfig, errorsList, topic ?? undefined, false);

      let responseText = `**Feed Refresh Complete & Running LLM Review...**\n\n`;
      let totalNew = 0;
      let totalPosted = 0;

      for (const [t, counts] of Object.entries(countsMap)) {
        responseText += `- **${t}**: Checked ${counts.checked} | New ${counts.newItems} | Posted ${counts.posted}\n`;
        totalNew += counts.newItems;
        totalPosted += counts.posted;
      }

      responseText += `\nTotal: Ingested ${totalNew} new articles, posted ${totalPosted} to Discord.\n`;

      if (errorsList.length > 0) {
        responseText += `\n**Errors encountered during check:**\n`;
        for (const err of errorsList) {
          const errorLine = `- Topic *${err.topic}*, Source *${err.source}*: ${err.message}\n`;
          if (responseText.length + errorLine.length > 1950) {
            responseText += `\n*...and ${errorsList.length - errorsList.indexOf(err)} more errors (truncated).*`;
            break;
          }
          responseText += errorLine;
        }
      }

      await interaction.editReply({ content: responseText });

      // Run LLM review for the refreshed topics
      const refreshedTopics = topic ? [topic] : Object.keys(appConfig.topics);
      let reviewLogged = false;
      for (const t of refreshedTopics) {
        try {
          await runPeriodicReview(t, client);
          reviewLogged = true;
        } catch (reviewErr) {
          console.error(`[Refresh Command] Error in runPeriodicReview for topic ${t}:`, reviewErr);
        }
      }

      if (reviewLogged) {
        responseText += `\n**LLM Editorial Review pass completed!** Duplicate threads merged & consolidated.`;
        await interaction.editReply({ content: responseText });
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to run refresh: ${msg}`
    });
  }
}

export async function handleStatsCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    const totalCount = await prisma.article.count();
    const postedCount = await prisma.article.count({
      where: { status: "POSTED" }
    });
    const removedCount = await prisma.article.count({
      where: { status: "REMOVED" }
    });
    const skippedCount = totalCount - postedCount - removedCount;

    const topicStats = await prisma.article.groupBy({
      by: ["topic"],
      _count: {
        _all: true
      }
    });

    const topicPostedStats = await prisma.article.groupBy({
      by: ["topic"],
      where: { status: "POSTED" },
      _count: {
        _all: true
      }
    });

    const topicRemovedStats = await prisma.article.groupBy({
      by: ["topic"],
      where: { status: "REMOVED" },
      _count: {
        _all: true
      }
    });

    let responseText = `**Operational Statistics**\n`;
    responseText += `- Total Indexed Articles: **${totalCount}**\n`;
    responseText += `- Total Posted to Discord: **${postedCount}**\n`;
    responseText += `- Total Manually Removed: **${removedCount}**\n`;
    responseText += `- Total Skipped/Deduplicated: **${skippedCount}**\n\n`;

    responseText += `**Topic Indexing Breakdown:**\n`;
    const configuredTopics = Object.keys(appConfig.topics);
    for (const t of configuredTopics) {
      const totalForTopic = topicStats.find((s) => s.topic === t)?._count._all ?? 0;
      const postedForTopic = topicPostedStats.find((s) => s.topic === t)?._count._all ?? 0;
      const removedForTopic = topicRemovedStats.find((s) => s.topic === t)?._count._all ?? 0;
      const skippedForTopic = totalForTopic - postedForTopic - removedForTopic;
      responseText += `- **${t}**: Total: ${totalForTopic} | Posted: ${postedForTopic} | Removed: ${removedForTopic} | Skipped: ${skippedForTopic}\n`;
    }

    await interaction.editReply({ content: responseText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to fetch statistics: ${msg}`
    });
  }
}

export async function handleSearchCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  const query = interaction.options.getString("query", true);
  const topic = interaction.options.getString("topic");

  if (topic && !appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const articles = await prisma.article.findMany({
      where: {
        title: {
          contains: query
        },
        ...(topic ? { topic } : {})
      },
      orderBy: {
        firstSeenAt: "desc"
      },
      take: 10
    });

    if (articles.length === 0) {
      await interaction.editReply({
        content: `No articles matching "${query}" were found${topic ? ` under topic "${topic}"` : ""}.`
      });
      return;
    }

    let responseText = `**Search Results for "${query}"** (showing top ${articles.length}):\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const timeStr = art.publishedAt ? `<t:${Math.floor(art.publishedAt.getTime() / 1000)}:R>` : "unknown time";
      const link = art.url ? `[${art.title}](${art.url})` : art.title;
      const scoreStr = art.score !== null ? `(Score: ${art.score})` : "";
      const statusText = formatArticleStatus(art.status, art.postedAt, art.statusReason);
      const statusIcon = art.postedAt ? "✅" : "❌";
      const statusStr = `${statusIcon} ${statusText}`;
      const line = `${i + 1}. [${art.topic}] ${link} ${scoreStr} - ${statusStr} - Published ${timeStr}\n`;

      if (responseText.length + line.length > 1950) {
        responseText += `\n*...and more items (truncated).*`;
        break;
      }
      responseText += line;
    }

    await interaction.editReply({ content: responseText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to search articles: ${msg}`
    });
  }
}

export async function handleTopicsCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  try {
    let responseText = `**Configured News Topics**\n\n`;

    for (const [topic, settings] of Object.entries(appConfig.topics)) {
      const statusSuffix = settings.disabled ? " 🔴 (Disabled)" : "";
      responseText += `- **${topic}**${statusSuffix}\n`;
      responseText += `  * Channel: <#${settings.channelId}>\n`;
      if (settings.emoji) {
        responseText += `  * Emoji: ${settings.emoji}\n`;
      }
      responseText += `  * Threshold: \`${settings.postThreshold}\`\n`;
      const topicSources = appConfig.sources[topic] || [];
      responseText += `  * Sources (${topicSources.length}) by intent: ${getSourceIntentBreakdown(topicSources)}\n`;
      responseText += `  * Intent routing: ${formatIntentPolicies(settings.intentRouting)}\n`;
      responseText += `  * Posting controls: ${formatPostingControlsSummary(settings)}\n`;

      const maxKeywordsToShow = 10;
      let keywordsStr = settings.keywords.slice(0, maxKeywordsToShow).map(k => `\`${k}\``).join(", ");
      if (settings.keywords.length > maxKeywordsToShow) {
        keywordsStr += `, ... and ${settings.keywords.length - maxKeywordsToShow} more`;
      }
      responseText += `  * Keywords (${settings.keywords.length}): ${keywordsStr || "*None*"}\n`;

      if (settings.locationKeywords && settings.locationKeywords.length > 0) {
        const maxLocationsToShow = 10;
        let locationsStr = settings.locationKeywords.slice(0, maxLocationsToShow).map(l => `\`${l}\``).join(", ");
        if (settings.locationKeywords.length > maxLocationsToShow) {
          locationsStr += `, ... and ${settings.locationKeywords.length - maxLocationsToShow} more`;
        }
        responseText += `  * Locations (${settings.locationKeywords.length}): ${locationsStr}\n`;
      }

      if (settings.blockedTerms && settings.blockedTerms.length > 0) {
        const maxBlockedToShow = 10;
        let blockedStr = settings.blockedTerms.slice(0, maxBlockedToShow).map(b => `\`${b}\``).join(", ");
        if (settings.blockedTerms.length > maxBlockedToShow) {
          blockedStr += `, ... and ${settings.blockedTerms.length - maxBlockedToShow} more`;
        }
        responseText += `  * Blocked Terms (${settings.blockedTerms.length}): ${blockedStr}\n`;
      }
      responseText += '\n';
    }

    await interaction.reply({
      content: responseText,
      ephemeral: true
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.reply({
      content: `Failed to list topics: ${msg}`,
      ephemeral: true
    });
  }
}

export async function handleSourcesCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  const topic = interaction.options.getString("topic");

  if (topic && !appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const list: string[] = [];
    const targetTopics = topic ? [topic] : Object.keys(appConfig.sources);

    for (const t of targetTopics) {
      const feeds = appConfig.sources[t] || [];
      list.push(`**Topic: ${t}** (${feeds.length} feeds):`);
      list.push(`Intent defaults: ${getSourceIntentBreakdown(feeds)}`);
      list.push(`Intent routing: ${formatIntentPolicies(appConfig.topics[t]?.intentRouting)}`);
      for (const feed of feeds) {
        list.push(`- _${feed.name}_ (${formatSourceIntentDetails(feed)}): <${feed.url}>`);
      }
      list.push("");
    }

    const header = `**Configured RSS Sources**\n\n`;
    const chunks = chunkLines(header, list);

    await interaction.editReply({ content: chunks[0] });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, ephemeral: true });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to list sources: ${msg}`
    });
  }
}

export async function handleFavoritesCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  const topic = interaction.options.getString("topic");
  const query = interaction.options.getString("query");
  const source = interaction.options.getString("source");
  const since = interaction.options.getString("since");
  const limitInput = interaction.options.getInteger("limit");

  const limit = limitInput ? Math.min(Math.max(limitInput, 1), 50) : 20;

  if (topic && !appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const favorites = await getFavorites(interaction.user.id, {
      topic: topic ?? undefined,
      query: query ?? undefined,
      source: source ?? undefined,
      since: since ?? undefined,
      limit
    });

    if (favorites.length === 0) {
      await interaction.editReply({
        content: "You don't have any matching favorited articles yet."
      });
      return;
    }

    let responseText = `**Your Favorited Articles** (showing ${favorites.length} items):\n\n`;
    for (let i = 0; i < favorites.length; i++) {
      const fav = favorites[i];
      const art = fav.article;
      const savedTimeStr = `<t:${Math.floor(fav.savedAt.getTime() / 1000)}:R>`;
      const link = art.url ? `[${art.title}](${art.url})` : art.title;
      const instapaperStr = fav.instapaperStatus === "SUCCESS"
        ? " 📑(Instapaper)"
        : fav.instapaperStatus === "FAILED"
        ? " ⚠️(Instapaper Failed)"
        : "";

      const line = `${i + 1}. [${art.topic}] **${art.source}**: ${link}${instapaperStr} - Saved ${savedTimeStr}\n`;

      if (responseText.length + line.length > 1950) {
        responseText += `\n*...and more items (truncated).*`;
        break;
      }
      responseText += line;
    }

    await interaction.editReply({ content: responseText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to retrieve favorites: ${msg}`
    });
  }
}

export async function handleUnfavoriteCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  const articleInput = interaction.options.getString("article", true);

  try {
    await interaction.deferReply({ ephemeral: true });

    // 1. Try to delete directly by favorite ID (UUID string)
    let deleted = await deleteFavoriteById(interaction.user.id, articleInput);

    // 2. Fallback: If not deleted (e.g. they typed a search term), search and delete the unique match
    if (!deleted) {
      const matches = await getFavorites(interaction.user.id, {
        query: articleInput,
        limit: 5
      });

      if (matches.length === 1) {
        deleted = await deleteFavoriteById(interaction.user.id, matches[0].id);
      } else if (matches.length > 1) {
        const matchNames = matches.map((m) => `• "${m.article.title}"`).join("\n");
        await interaction.editReply({
          content: `Multiple favorites matched your search "${articleInput}". Please be more specific:\n${matchNames}`
        });
        return;
      } else {
        await interaction.editReply({
          content: `No favorited article matched "${articleInput}".`
        });
        return;
      }
    }

    if (deleted) {
      const title = deleted.article.title;
      await interaction.editReply({
        content: `Successfully removed favorite: "${title}"`
      });
    } else {
      await interaction.editReply({
        content: `Failed to remove the favorite article.`
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Error removing favorite: ${msg}`
    });
  }
}

function extractKeywordsFromBreakdown(breakdownList: string[]): {
  keywords: string[];
  locations: string[];
  blocked: string[];
} {
  const keywords: string[] = [];
  const locations: string[] = [];
  const blocked: string[] = [];

  for (const item of breakdownList) {
    const kwMatch = item.match(/(?:Title|Summary) matched keyword (.+?) \(\+\d+\)/);
    if (kwMatch) {
      const words = kwMatch[1].split(",").map(w => w.replace(/"/g, "").trim());
      keywords.push(...words);
    }

    const locMatch = item.match(/(?:Title|Summary) matched location keyword (.+?) \(\+\d+\)/);
    if (locMatch) {
      const words = locMatch[1].split(",").map(w => w.replace(/"/g, "").trim());
      locations.push(...words);
    }

    const blockedMatch = item.match(/Blocked term matched (.+?) \(-\d+\)/);
    if (blockedMatch) {
      const words = blockedMatch[1].split(",").map(w => w.replace(/"/g, "").trim());
      blocked.push(...words);
    }
  }

  return { keywords, locations, blocked };
}

export async function handleAuditCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const topic = interaction.options.getString("topic", true);
  const limitInput = interaction.options.getInteger("limit");
  const query = interaction.options.getString("query");
  const source = interaction.options.getString("source");
  const status = interaction.options.getString("status");

  const limit = limitInput ? Math.min(Math.max(limitInput, 1), 100) : 10;

  if (!appConfig.topics[topic]) {
    const configured = Object.keys(appConfig.topics).join(", ");
    await interaction.reply({
      content: `Unknown topic: "${topic}". Configured topics are: ${configured}`,
      ephemeral: true
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const logs = await getCurationLogs({
      topic,
      limit,
      query: query ?? undefined,
      source: source ?? undefined,
      status: status ?? undefined
    });

    if (logs.length === 0) {
      await interaction.editReply({
        content: `No curation logs found for topic: "${topic}" matching filters.`
      });
      return;
    }

    const filterParts = [
      `topic: "${topic}"`,
      source ? `source: "${source}"` : null,
      status ? `status: "${status}"` : null,
      query ? `query: "${query}"` : null,
    ].filter(Boolean).join(", ");
    let outputText = `**Curation Audit Logs for ${filterParts}** (showing ${logs.length} items):\n\n`;
    let fileText = `=========================================\n`;
    fileText += `CURATION AUDIT LOGS FOR ${filterParts.toUpperCase()}\n`;
    fileText += `Generated: ${new Date().toISOString()}\n`;
    fileText += `=========================================\n\n`;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const timeStr = `<t:${Math.floor(log.createdAt.getTime() / 1000)}:R>`;
      const formattedTime = log.createdAt.toISOString();
      const scoreStr = `(Score: ${log.score})`;
      const link = log.url ? `[${log.title}](${log.url})` : log.title;

      let breakdownList: string[] = [];
      try {
        breakdownList = JSON.parse(log.breakdown);
      } catch (_) {
        breakdownList = [log.breakdown];
      }

      let statusPrefix = log.status === "POSTED" ? "✅ [POSTED]" : `❌ [${log.status}]`;
      if (log.status === "REMOVED") {
        statusPrefix = "🗑️ [REMOVED]";
      }
      let line = `${i + 1}. ${statusPrefix} ${link} ${scoreStr} - Source: *${log.source}* - Evaluated ${timeStr}\n`;
      for (const reason of breakdownList) {
        line += `   • ${reason}\n`;
      }
      line += "\n";

      fileText += `${i + 1}. [${log.status}] ${log.title}\n`;
      fileText += `   Score: ${log.score}\n`;
      fileText += `   Source: ${log.source}\n`;
      fileText += `   URL: ${log.url ?? "None"}\n`;
      fileText += `   Date: ${formattedTime}\n`;
      fileText += `   Scoring Breakdown:\n`;
      for (const reason of breakdownList) {
        fileText += `     - ${reason}\n`;
      }
      fileText += `-----------------------------------------\n\n`;

      outputText += line;
    }

    if (status === "REMOVED" || logs.some(l => l.status === "REMOVED")) {
      const allRemovedLogs = await getCurationLogs({
        topic,
        limit: 100,
        source: source ?? undefined,
        status: "REMOVED"
      });

      const counts: Record<string, number> = {};
      const locationCounts: Record<string, number> = {};
      const blockedCounts: Record<string, number> = {};

      for (const log of allRemovedLogs) {
        let breakdownList: string[] = [];
        try {
          breakdownList = JSON.parse(log.breakdown);
        } catch (_) {
          breakdownList = [log.breakdown];
        }

        const cleanedBreakdown = breakdownList.map(r => r.startsWith("Original: ") ? r.replace(/^Original: /, "") : r);
        const { keywords, locations, blocked } = extractKeywordsFromBreakdown(cleanedBreakdown);
        for (const kw of keywords) counts[kw] = (counts[kw] || 0) + 1;
        for (const loc of locations) locationCounts[loc] = (locationCounts[loc] || 0) + 1;
        for (const bl of blocked) blockedCounts[bl] = (blockedCounts[bl] || 0) + 1;
      }

      const topKws = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([kw, count]) => `\`${kw}\` (${count}x)`)
        .join(", ");

      const topLocs = Object.entries(locationCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([loc, count]) => `\`${loc}\` (${count}x)`)
        .join(", ");

      const diagnosticSummary = `⚠️ **Culprit Keywords Summary (Last 100 removals)**:\n` +
        `• **Core Keywords:** ${topKws || "None"}\n` +
        `• **Location Keywords:** ${topLocs || "None"}\n\n`;

      outputText = diagnosticSummary + outputText;

      const fileDiagnostic = `=========================================\n` +
        `CULPRIT KEYWORDS SUMMARY (Last 100 removals):\n` +
        `  Core Keywords: ${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,c])=>`${k} (${c}x)`).join(", ") || "None"}\n` +
        `  Location Keywords: ${Object.entries(locationCounts).sort((a,b)=>b[1]-a[1]).map(([k,c])=>`${k} (${c}x)`).join(", ") || "None"}\n` +
        `=========================================\n\n`;

      fileText = fileDiagnostic + fileText;
    }

    if (outputText.length > 1950 || limit > 15) {
      const buffer = Buffer.from(fileText, "utf-8");
      const sourceSlug = source ? `-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : "";
      const attachment = new AttachmentBuilder(buffer, { name: `audit-log-${topic}${sourceSlug}.txt` });
      await interaction.editReply({
        content: `Audit log list is too long for a Discord message, or a large limit was requested. Attached is the full log text file for **${filterParts}** (${logs.length} entries).`,
        files: [attachment]
      });
    } else {
      await interaction.editReply({ content: outputText });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to retrieve curation logs: ${msg}`
    });
  }
}

function isValidEmoji(emoji: string): boolean {
  // Allow Discord custom emojis: <:name:id> or <a:name:id>
  const customEmojiRegex = /^<a?:[a-zA-Z0-9_]+:[0-9]+>$/;
  if (customEmojiRegex.test(emoji)) {
    return true;
  }
  // Allow standard unicode emojis: typically no spaces, length <= 16
  if (emoji.includes(" ") || emoji.length > 16) {
    return false;
  }
  return true;
}

export async function handleTopicCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const list = Object.entries(appConfig.topics).map(([name, config]) => {
      const status = config.disabled ? "🔴 [DISABLED]" : "🟢 [ACTIVE]";
      const emojiPrefix = config.emoji ? `${config.emoji} ` : "";
      return `• **${name}** ${status} (Channel: <#${config.channelId}>, Threshold: ${config.postThreshold}, Emoji: ${emojiPrefix || "none"})`;
    });
    
    if (list.length === 0) {
      await interaction.reply({ content: "No topics configured.", ephemeral: true });
      return;
    }

    await interaction.reply({
      content: `### Configured Topics:\n${list.join("\n")}`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "view") {
    const topic = interaction.options.getString("topic", true);
    const config = appConfig.topics[topic];
    if (!config) {
      await interaction.reply({ content: `Unknown topic: "${topic}"`, ephemeral: true });
      return;
    }

    const status = config.disabled ? "🔴 DISABLED" : "🟢 ACTIVE";
    const emojiPrefix = config.emoji ? `${config.emoji}` : "none";
    const sources = appConfig.sources[topic] || [];
    const sourceList = sources.length > 0
      ? sources.map(s => `  • **${s.name}** (${s.trusted ? "trusted" : "untrusted"}) - ${s.url}`).join("\n")
      : "  *(no sources)*";

    const locationsStr = config.locationKeywords && config.locationKeywords.length > 0
      ? `- **Locations (${config.locationKeywords.length}):** ${config.locationKeywords.join(", ")}\n`
      : "";

    const content = `### Topic Lane: **${topic}** (${status})\n` +
      `- **Channel:** <#${config.channelId}>\n` +
      `- **Post Threshold:** ${config.postThreshold}\n` +
      `- **Emoji Prefix:** ${emojiPrefix}\n` +
      `- **Sources (${sources.length}) by Intent:** ${getSourceIntentBreakdown(sources)}\n` +
      `- **Intent Routing:** ${formatIntentPolicies(config.intentRouting)}\n` +
      `- **Keywords (${config.keywords.length}):** ${config.keywords.join(", ") || "none"}\n` +
      locationsStr +
      `- **Blocked Terms (${config.blockedTerms.length}):** ${config.blockedTerms.join(", ") || "none"}\n` +
      `**Sources:**\n${sourceList}`;

    await interaction.reply({ content, ephemeral: true });
    return;
  }

  if (subcommand === "create") {
    const name = interaction.options.getString("name", true).toLowerCase();
    const channel = interaction.options.getChannel("channel", true);
    const threshold = interaction.options.getInteger("threshold") ?? 20;
    const emoji = interaction.options.getString("emoji") ?? undefined;

    // Validate name
    if (!/^[a-z0-9-]+$/.test(name)) {
      await interaction.reply({
        content: "Invalid topic name. Topic names must contain only lowercase alphanumeric characters and hyphens (e.g. `tech-news`, `sports`).",
        ephemeral: true
      });
      return;
    }

    if (appConfig.topics[name]) {
      await interaction.reply({
        content: `A topic named "${name}" already exists.`,
        ephemeral: true
      });
      return;
    }

    // Validate emoji
    if (emoji !== undefined && !isValidEmoji(emoji)) {
      await interaction.reply({
        content: `Invalid emoji format. Please provide a standard emoji or a valid Discord custom emoji (e.g. \`<:name:id>\`).`,
        ephemeral: true
      });
      return;
    }

    // Validations passed! Modify config.
    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedTopics = { ...appConfig.topics };
      updatedTopics[name] = {
        channelId: channel.id,
        postThreshold: threshold,
        emoji,
        keywords: [],
        locationKeywords: [],
        blockedTerms: [],
        disabled: false
      };

      const updatedSources = { ...appConfig.sources };
      updatedSources[name] = [];

      await saveTopicsConfig(updatedTopics);
      await saveSourcesConfig(updatedSources);
      await reloadAppConfig(appConfig);

      await interaction.editReply({
        content: `Successfully created topic lane **${name}** linked to channel <#${channel.id}> (threshold: ${threshold}, emoji: ${emoji || "none"}).`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to create topic: ${err.message}`
      });
    }
    return;
  }

  // Common check for topic existence in other subcommands
  const topic = interaction.options.getString("topic", true);
  const config = appConfig.topics[topic];
  if (!config) {
    await interaction.reply({ content: `Unknown topic: "${topic}"`, ephemeral: true });
    return;
  }

  if (subcommand === "set-channel") {
    const channel = interaction.options.getChannel("channel", true);
    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedTopics = { ...appConfig.topics };
      updatedTopics[topic] = {
        ...config,
        channelId: channel.id
      };

      await saveTopicsConfig(updatedTopics);
      await reloadAppConfig(appConfig);

      await interaction.editReply({
        content: `Successfully updated channel for topic **${topic}** to <#${channel.id}>.`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to update channel: ${err.message}`
      });
    }
    return;
  }

  if (subcommand === "set-threshold") {
    const threshold = interaction.options.getInteger("threshold", true);
    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedTopics = { ...appConfig.topics };
      updatedTopics[topic] = {
        ...config,
        postThreshold: threshold
      };

      await saveTopicsConfig(updatedTopics);
      await reloadAppConfig(appConfig);

      await interaction.editReply({
        content: `Successfully updated post threshold for topic **${topic}** to **${threshold}**.`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to update threshold: ${err.message}`
      });
    }
    return;
  }

  if (subcommand === "set-emoji") {
    const emojiInput = interaction.options.getString("emoji", true);
    const emoji = emojiInput.toLowerCase() === "clear" ? undefined : emojiInput;

    if (emoji !== undefined && !isValidEmoji(emoji)) {
      await interaction.reply({
        content: `Invalid emoji format. Please provide a standard emoji, a valid Discord custom emoji, or \`clear\` to remove the emoji prefix.`,
        ephemeral: true
      });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedTopics = { ...appConfig.topics };
      updatedTopics[topic] = {
        ...config,
        emoji
      };

      await saveTopicsConfig(updatedTopics);
      await reloadAppConfig(appConfig);

      await interaction.editReply({
        content: emoji 
          ? `Successfully updated emoji prefix for topic **${topic}** to ${emoji}.`
          : `Successfully cleared emoji prefix for topic **${topic}**.`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to update emoji: ${err.message}`
      });
    }
    return;
  }

  if (subcommand === "disable") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedTopics = { ...appConfig.topics };
      const newDisabledState = !config.disabled;
      updatedTopics[topic] = {
        ...config,
        disabled: newDisabledState
      };

      await saveTopicsConfig(updatedTopics);
      await reloadAppConfig(appConfig);

      const statusWord = newDisabledState ? "disabled" : "enabled";
      const statusIcon = newDisabledState ? "🔴" : "🟢";
      await interaction.editReply({
        content: `${statusIcon} Topic **${topic}** is now **${statusWord}**.`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to toggle disabled state: ${err.message}`
      });
    }
    return;
  }
}

export async function handleSourceCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const topic = interaction.options.getString("topic", true);
    if (!appConfig.topics[topic]) {
      await interaction.reply({ content: `Unknown topic: "${topic}"`, ephemeral: true });
      return;
    }

    const sources = appConfig.sources[topic] || [];
    if (sources.length === 0) {
      await interaction.reply({ content: `No sources configured for topic "${topic}".`, ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const list = sources.map((s, index) => {
        const trustWord = s.trusted ? "[TRUSTED]" : "[UNTRUSTED]";
        const intentParts = [`intent: \`${s.intentDefault ?? "auto"}\``];
        if (s.routeHint) {
          intentParts.push(`route hint: \`${s.routeHint}\``);
        }
        if (s.tier !== undefined) {
          intentParts.push(`tier: \`${s.tier}\``);
        }
        return `${index + 1}. **${s.name}** - ${trustWord} - ${intentParts.join(", ")} - <${s.url}>`;
      });
      const header = `### Sources for Topic lane **${topic}** (${sources.length})\nIntent defaults: ${getSourceIntentBreakdown(sources)}\nIntent routing: ${formatIntentPolicies(appConfig.topics[topic]?.intentRouting)}\n`;
      const chunks = chunkLines(header, list);

      await interaction.editReply({ content: chunks[0] });
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({ content: chunk, ephemeral: true });
      }
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to list sources: ${err.message}`
      });
    }
    return;

  }

  if (subcommand === "add") {
    const topic = interaction.options.getString("topic", true);
    const name = interaction.options.getString("name", true).trim();
    const url = interaction.options.getString("url", true).trim();
    const trusted = interaction.options.getBoolean("trusted", true);

    if (!appConfig.topics[topic]) {
      await interaction.reply({ content: `Unknown topic: "${topic}"`, ephemeral: true });
      return;
    }

    // Validate URL
    try {
      new URL(url);
    } catch (_) {
      await interaction.reply({ content: `Invalid URL format: "${url}"`, ephemeral: true });
      return;
    }

    const currentSources = appConfig.sources[topic] || [];

    // Validate duplicate name (case insensitive)
    if (currentSources.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      await interaction.reply({ content: `A source named "${name}" already exists for topic "${topic}".`, ephemeral: true });
      return;
    }

    // Validate duplicate URL
    if (currentSources.some(s => s.url === url)) {
      await interaction.reply({ content: `A source with URL <${url}> already exists for topic "${topic}".`, ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedSources = { ...appConfig.sources };
      updatedSources[topic] = [
        ...currentSources,
        { name, url, trusted }
      ];

      await saveSourcesConfig(updatedSources);
      await reloadAppConfig(appConfig);

      const trustWord = trusted ? "trusted" : "untrusted";
      await interaction.editReply({
        content: `Successfully added ${trustWord} source **${name}** to topic **${topic}**.`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to add source: ${err.message}`
      });
    }
    return;
  }

  if (subcommand === "remove") {
    const topic = interaction.options.getString("topic", true);
    const name = interaction.options.getString("name", true).trim();

    if (!appConfig.topics[topic]) {
      await interaction.reply({ content: `Unknown topic: "${topic}"`, ephemeral: true });
      return;
    }

    const currentSources = appConfig.sources[topic] || [];
    const index = currentSources.findIndex(s => s.name.toLowerCase() === name.toLowerCase());

    if (index === -1) {
      await interaction.reply({ content: `No source named "${name}" found for topic "${topic}".`, ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const updatedSources = { ...appConfig.sources };
      const topicSources = [...currentSources];
      topicSources.splice(index, 1);
      updatedSources[topic] = topicSources;

      await saveSourcesConfig(updatedSources);
      await reloadAppConfig(appConfig);

      await interaction.editReply({
        content: `Successfully removed source **${name}** from topic **${topic}**.`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to remove source: ${err.message}`
      });
    }
    return;
  }
}

export async function handleKeywordCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const topicRaw = interaction.options.getString("topic", true);
  const targetTopics = topicRaw.split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

  if (targetTopics.length === 0) {
    await interaction.reply({
      content: "❌ **Error:** Topic cannot be empty or whitespace only.",
      ephemeral: true
    });
    return;
  }

  // Validate that all specified topics exist
  const unknownTopics = targetTopics.filter(topic => !appConfig.topics[topic]);
  if (unknownTopics.length > 0) {
    const configured = Object.keys(appConfig.topics).join(", ");
    if (targetTopics.length === 1) {
      await interaction.reply({
        content: `Unknown topic: "${targetTopics[0]}". Configured topics are: ${configured}`,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: `Unknown topic(s): ${unknownTopics.map(t => `"${t}"`).join(", ")}. Configured topics are: ${configured}`,
        ephemeral: true
      });
    }
    return;
  }

  if (subcommand === "view") {
    if (targetTopics.length === 1) {
      const topic = targetTopics[0];
      const topicConfig = appConfig.topics[topic];
      const keywords = topicConfig.keywords || [];
      const locationKeywords = topicConfig.locationKeywords || [];
      const blockedTerms = topicConfig.blockedTerms || [];

      let responseText = `### Keywords for Topic Lane: **${topic}**\n`;
      
      let standardList = keywords.map(k => `\`${k}\``).join(", ") || "*None*";
      let locationList = locationKeywords.map(k => `\`${k}\``).join(", ") || "*None*";
      let negativeList = blockedTerms.map(k => `\`${k}\``).join(", ") || "*None*";

      let line1 = `- **Standard Keywords (${keywords.length}):** ${standardList}\n`;
      let line2 = `- **Location Keywords (${locationKeywords.length}):** ${locationList}\n`;
      let line3 = `- **Negative Keywords (${blockedTerms.length}):** ${negativeList}\n`;

      if (responseText.length + line1.length + line2.length + line3.length > 1950) {
        await interaction.reply({ content: `Keywords list for **${topic}** is too long. Chunking response...`, ephemeral: true });
        
        let standardChunks: string[] = [];
        let currentChunk = `**Standard Keywords for ${topic} (${keywords.length}):**\n`;
        for (const k of keywords) {
          const item = `\`${k}\`, `;
          if (currentChunk.length + item.length > 1900) {
            standardChunks.push(currentChunk);
            currentChunk = ``;
          }
          currentChunk += item;
        }
        if (currentChunk) standardChunks.push(currentChunk);

        for (const chunk of standardChunks) {
          await interaction.followUp({ content: chunk, ephemeral: true });
        }

        if (locationKeywords.length > 0) {
          let locationChunks: string[] = [];
          let curChunk = `**Location Keywords for ${topic} (${locationKeywords.length}):**\n`;
          for (const k of locationKeywords) {
            const item = `\`${k}\`, `;
            if (curChunk.length + item.length > 1900) {
              locationChunks.push(curChunk);
              curChunk = ``;
            }
            curChunk += item;
          }
          if (curChunk) locationChunks.push(curChunk);

          for (const chunk of locationChunks) {
            await interaction.followUp({ content: chunk, ephemeral: true });
          }
        }

        if (blockedTerms.length > 0) {
          let negativeChunks: string[] = [];
          let curChunk = `**Negative Keywords for ${topic} (${blockedTerms.length}):**\n`;
          for (const k of blockedTerms) {
            const item = `\`${k}\`, `;
            if (curChunk.length + item.length > 1900) {
              negativeChunks.push(curChunk);
              curChunk = ``;
            }
            curChunk += item;
          }
          if (curChunk) negativeChunks.push(curChunk);

          for (const chunk of negativeChunks) {
            await interaction.followUp({ content: chunk, ephemeral: true });
          }
        }
      } else {
        await interaction.reply({
          content: responseText + line1 + line2 + line3,
          ephemeral: true
        });
      }
      return;
    } else {
      // Multiple topics view
      const parts: string[] = [];
      for (const topic of targetTopics) {
        const topicConfig = appConfig.topics[topic];
        const keywords = topicConfig.keywords || [];
        const locationKeywords = topicConfig.locationKeywords || [];
        const blockedTerms = topicConfig.blockedTerms || [];

        let standardList = keywords.map(k => `\`${k}\``).join(", ") || "*None*";
        let locationList = locationKeywords.map(k => `\`${k}\``).join(", ") || "*None*";
        let negativeList = blockedTerms.map(k => `\`${k}\``).join(", ") || "*None*";

        parts.push(
          `### Keywords for Topic Lane: **${topic}**\n` +
          `- **Standard Keywords (${keywords.length}):** ${standardList}\n` +
          `- **Location Keywords (${locationKeywords.length}):** ${locationList}\n` +
          `- **Negative Keywords (${blockedTerms.length}):** ${negativeList}\n`
        );
      }

      const fullContent = parts.join("\n");
      if (fullContent.length > 1950) {
        await interaction.reply({ content: `Combined keywords list is too long. Chunking response by topic...`, ephemeral: true });
        
        for (const topic of targetTopics) {
          const topicConfig = appConfig.topics[topic];
          const keywords = topicConfig.keywords || [];
          const locationKeywords = topicConfig.locationKeywords || [];
          const blockedTerms = topicConfig.blockedTerms || [];

          let responseText = `### Keywords for Topic Lane: **${topic}**\n`;
          let standardList = keywords.map(k => `\`${k}\``).join(", ") || "*None*";
          let locationList = locationKeywords.map(k => `\`${k}\``).join(", ") || "*None*";
          let negativeList = blockedTerms.map(k => `\`${k}\``).join(", ") || "*None*";

          let line1 = `- **Standard Keywords (${keywords.length}):** ${standardList}\n`;
          let line2 = `- **Location Keywords (${locationKeywords.length}):** ${locationList}\n`;
          let line3 = `- **Negative Keywords (${blockedTerms.length}):** ${negativeList}\n`;

          const topicContent = responseText + line1 + line2 + line3;
          if (topicContent.length > 1950) {
            // Chunk standard, location, negative keywords individually for this topic
            let standardChunks: string[] = [];
            let currentChunk = `**Standard Keywords for ${topic} (${keywords.length}):**\n`;
            for (const k of keywords) {
              const item = `\`${k}\`, `;
              if (currentChunk.length + item.length > 1900) {
                standardChunks.push(currentChunk);
                currentChunk = ``;
              }
              currentChunk += item;
            }
            if (currentChunk) standardChunks.push(currentChunk);

            await interaction.followUp({ content: `### Keywords for Topic Lane: **${topic}**`, ephemeral: true });
            for (const chunk of standardChunks) {
              await interaction.followUp({ content: chunk, ephemeral: true });
            }

            if (locationKeywords.length > 0) {
              let locationChunks: string[] = [];
              let curChunk = `**Location Keywords for ${topic} (${locationKeywords.length}):**\n`;
              for (const k of locationKeywords) {
                const item = `\`${k}\`, `;
                if (curChunk.length + item.length > 1900) {
                  locationChunks.push(curChunk);
                  curChunk = ``;
                }
                curChunk += item;
              }
              if (curChunk) locationChunks.push(curChunk);

              for (const chunk of locationChunks) {
                await interaction.followUp({ content: chunk, ephemeral: true });
              }
            }

            if (blockedTerms.length > 0) {
              let negativeChunks: string[] = [];
              let curChunk = `**Negative Keywords for ${topic} (${blockedTerms.length}):**\n`;
              for (const k of blockedTerms) {
                const item = `\`${k}\`, `;
                if (curChunk.length + item.length > 1900) {
                  negativeChunks.push(curChunk);
                  curChunk = ``;
                }
                curChunk += item;
              }
              if (curChunk) negativeChunks.push(curChunk);

              for (const chunk of negativeChunks) {
                await interaction.followUp({ content: chunk, ephemeral: true });
              }
            }
          } else {
            await interaction.followUp({ content: topicContent, ephemeral: true });
          }
        }
      } else {
        await interaction.reply({
          content: fullContent,
          ephemeral: true
        });
      }
      return;
    }
  }

  // Auth gate for add / remove
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const keywordRaw = interaction.options.getString("keyword", true);
  const newKeywords = keywordRaw.split(",").map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
  const type = interaction.options.getString("type") || "standard";

  if (newKeywords.length === 0) {
    await interaction.reply({
      content: "❌ **Error:** Keyword cannot be empty or whitespace only.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "add") {
    const addedMap: Record<string, string[]> = {};
    const duplicatesMap: Record<string, string[]> = {};
    const summaryLines: string[] = [];
    let totalAdded = 0;

    const updatedTopics = { ...appConfig.topics };

    for (const topic of targetTopics) {
      const topicConfig = updatedTopics[topic];
      const added: string[] = [];
      const duplicates: string[] = [];

      for (const kw of newKeywords) {
        const standardExists = topicConfig.keywords.includes(kw);
        const locationExists = (topicConfig.locationKeywords || []).includes(kw);
        const negativeExists = (topicConfig.blockedTerms || []).includes(kw);

        if (standardExists || locationExists || negativeExists) {
          duplicates.push(kw);
        } else {
          added.push(kw);
        }
      }

      addedMap[topic] = added;
      duplicatesMap[topic] = duplicates;

      if (added.length > 0) {
        const currentConfig = { ...topicConfig };
        if (type === "standard") {
          currentConfig.keywords = [...currentConfig.keywords, ...added];
        } else if (type === "location") {
          currentConfig.locationKeywords = [...(currentConfig.locationKeywords || []), ...added];
        } else {
          currentConfig.blockedTerms = [...(currentConfig.blockedTerms || []), ...added];
        }
        updatedTopics[topic] = currentConfig;
        totalAdded += added.length;
      }

      let line = `• **${topic}**: `;
      if (added.length > 0) {
        line += `Added: ${added.map(k => `\`${k}\``).join(", ")}`;
      } else {
        line += `No new keywords added`;
      }
      if (duplicates.length > 0) {
        line += ` (Skipped duplicate(s): ${duplicates.map(d => `\`${d}\``).join(", ")})`;
      }
      summaryLines.push(line);
    }

    if (totalAdded === 0) {
      if (targetTopics.length === 1) {
        const topic = targetTopics[0];
        const duplicates = duplicatesMap[topic];
        const topicConfig = appConfig.topics[topic];
        let errorMsg = "";
        if (duplicates.length === 1) {
          const kw = duplicates[0];
          const standardExists = topicConfig.keywords.includes(kw);
          const locationExists = (topicConfig.locationKeywords || []).includes(kw);
          const negativeExists = (topicConfig.blockedTerms || []).includes(kw);
          let typeLabel = "standard";
          if (locationExists) typeLabel = "location";
          if (negativeExists) typeLabel = "negative";
          errorMsg = `❌ **Error:** The keyword \`${kw}\` already exists as a ${typeLabel} keyword for topic **${topic}**.`;
        } else {
          errorMsg = `❌ **Error:** The keyword(s) ${duplicates.map(d => `\`${d}\``).join(", ")} already exist for topic **${topic}**.`;
        }
        await interaction.reply({
          content: errorMsg,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `❌ **Error:** No new keywords were added to any topics.\n${summaryLines.join("\n")}`,
          ephemeral: true
        });
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      await saveTopicsConfig(updatedTopics);
      await reloadAppConfig(appConfig);

      for (const topic of targetTopics) {
        const added = addedMap[topic];
        for (const kw of added) {
          console.log(`[Keyword Audit] [${new Date().toISOString()}] User ${interaction.user.id} added keyword "${kw}" (type: ${type}) to topic "${topic}"`);
        }
      }

      let msg = "";
      if (targetTopics.length === 1) {
        const topic = targetTopics[0];
        const added = addedMap[topic];
        const duplicates = duplicatesMap[topic];
        if (added.length === 1) {
          msg = `✅ Successfully added **${type}** keyword \`${added[0]}\` to topic **${topic}**.`;
        } else {
          msg = `✅ Successfully added **${type}** keyword(s): ${added.map(k => `\`${k}\``).join(", ")} to topic **${topic}**.`;
        }
        if (duplicates.length > 0) {
          msg += ` (Skipped duplicate(s): ${duplicates.map(d => `\`${d}\``).join(", ")})`;
        }
      } else {
        msg = `✅ **Successfully updated keywords (type: ${type}):**\n${summaryLines.join("\n")}`;
      }

      await interaction.editReply({
        content: msg
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `❌ **Error:** Failed to add keyword(s): ${err.message}`
      });
    }
    return;
  }


  if (subcommand === "remove") {
    const removedMap: Record<string, string[]> = {};
    const missingMap: Record<string, string[]> = {};
    const summaryLines: string[] = [];
    let totalRemoved = 0;

    const updatedTopics = { ...appConfig.topics };

    for (const topic of targetTopics) {
      const topicConfig = updatedTopics[topic];
      const removed: string[] = [];
      const missing: string[] = [];

      for (const kw of newKeywords) {
        let exists = false;
        if (type === "standard") {
          exists = topicConfig.keywords.includes(kw);
        } else if (type === "location") {
          exists = (topicConfig.locationKeywords || []).includes(kw);
        } else {
          exists = (topicConfig.blockedTerms || []).includes(kw);
        }

        if (exists) {
          removed.push(kw);
        } else {
          missing.push(kw);
        }
      }

      removedMap[topic] = removed;
      missingMap[topic] = missing;

      if (removed.length > 0) {
        const currentConfig = { ...topicConfig };
        if (type === "standard") {
          currentConfig.keywords = currentConfig.keywords.filter(k => !removed.includes(k));
        } else if (type === "location") {
          currentConfig.locationKeywords = (currentConfig.locationKeywords || []).filter(k => !removed.includes(k));
        } else {
          currentConfig.blockedTerms = (currentConfig.blockedTerms || []).filter(k => !removed.includes(k));
        }
        updatedTopics[topic] = currentConfig;
        totalRemoved += removed.length;
      }

      let line = `• **${topic}**: `;
      if (removed.length > 0) {
        line += `Removed: ${removed.map(k => `\`${k}\``).join(", ")}`;
      } else {
        line += `No keywords removed`;
      }
      if (missing.length > 0) {
        line += ` (Skipped non-existent(s): ${missing.map(m => `\`${m}\``).join(", ")})`;
      }
      summaryLines.push(line);
    }

    if (totalRemoved === 0) {
      if (targetTopics.length === 1) {
        const topic = targetTopics[0];
        const missing = missingMap[topic];
        let errorMsg = "";
        if (missing.length === 1) {
          errorMsg = `❌ **Error:** The keyword \`${missing[0]}\` does not exist as a **${type}** keyword for topic **${topic}**.`;
        } else {
          errorMsg = `❌ **Error:** The keyword(s) ${missing.map(m => `\`${m}\``).join(", ")} do not exist as **${type}** keywords for topic **${topic}**.`;
        }
        await interaction.reply({
          content: errorMsg,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: `❌ **Error:** No keywords were removed from any topics.\n${summaryLines.join("\n")}`,
          ephemeral: true
        });
      }
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      await saveTopicsConfig(updatedTopics);
      await reloadAppConfig(appConfig);

      for (const topic of targetTopics) {
        const removed = removedMap[topic];
        for (const kw of removed) {
          console.log(`[Keyword Audit] [${new Date().toISOString()}] User ${interaction.user.id} removed keyword "${kw}" (type: ${type}) from topic "${topic}"`);
        }
      }

      let msg = "";
      if (targetTopics.length === 1) {
        const topic = targetTopics[0];
        const removed = removedMap[topic];
        const missing = missingMap[topic];
        if (removed.length === 1) {
          msg = `✅ Successfully removed **${type}** keyword \`${removed[0]}\` from topic **${topic}**.`;
        } else {
          msg = `✅ Successfully removed **${type}** keyword(s): ${removed.map(k => `\`${k}\``).join(", ")} from topic **${topic}**.`;
        }
        if (missing.length > 0) {
          msg += ` (Skipped non-existent(s): ${missing.map(m => `\`${m}\``).join(", ")})`;
        }
      } else {
        msg = `✅ **Successfully updated keywords (type: ${type}):**\n${summaryLines.join("\n")}`;
      }

      await interaction.editReply({
        content: msg
      });
    } catch (err: any) {
      await interaction.editReply({
        content: `❌ **Error:** Failed to remove keyword(s): ${err.message}`
      });
    }
    return;
  }
}

export async function handleRemoveArticleCommand(
  interaction: MessageContextMenuCommandInteraction
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const messageId = interaction.targetMessage.id;

  // Verify the article exists in the database
  const article = await prisma.article.findFirst({
    where: { discordMessageId: messageId }
  });

  if (!article) {
    await interaction.reply({
      content: "Error: This message is not associated with an ingested article in the database.",
      ephemeral: true
    });
    return;
  }

  // Create the modal
  const modal = new ModalBuilder()
    .setCustomId(`remove-article-modal_${messageId}`)
    .setTitle("Remove Article");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Reason for removal")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("e.g. Off-topic, spam, duplication");

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal);
}

export async function handleRemoveArticleModal(
  interaction: ModalSubmitInteraction,
  client: Client
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to perform this action.",
      ephemeral: true
    });
    return;
  }

  const customId = interaction.customId;
  const messageId = customId.split("_")[1];
  const reason = interaction.fields.getTextInputValue("reason");

  try {
    await interaction.deferReply({ ephemeral: true });

    // Find the article
    const article = await prisma.article.findFirst({
      where: { discordMessageId: messageId }
    });

    if (!article) {
      await interaction.editReply({
        content: "Error: Article not found in database."
      });
      return;
    }

    if (!article.discordChannelId || !article.discordMessageId) {
      await interaction.editReply({
        content: "Failed to remove article: the stored article is missing Discord message metadata."
      });
      return;
    }

    try {
      const channel = await client.channels.fetch(article.discordChannelId);
      if (!channel?.isTextBased()) {
        await interaction.editReply({
          content: "Failed to remove article: the stored Discord channel is not available for message deletion."
        });
        return;
      }

      const msg = await channel.messages.fetch(article.discordMessageId);
      await msg.delete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Could not delete message from Discord:`, err);
      await interaction.editReply({
        content: `Failed to remove article from Discord. Database status was not changed. Error: ${msg}`
      });
      return;
    }

    // Update database status of the article
    await prisma.article.update({
      where: {
        id_topic: {
          id: article.id,
          topic: article.topic
        }
      },
      data: {
        status: "REMOVED",
        statusReason: reason
      }
    });

    // Get the original curation log (status = "POSTED") to extract breakdown
    const originalLog = await prisma.curationLog.findFirst({
      where: {
        topic: article.topic,
        url: article.url,
        status: "POSTED"
      }
    });

    let originalBreakdown: string[] = [];
    if (originalLog) {
      try {
        originalBreakdown = JSON.parse(originalLog.breakdown);
      } catch (_) {
        originalBreakdown = [originalLog.breakdown];
      }
    }

    // Write a CurationLog entry for status "REMOVED"
    const breakdown = [
      `Removed by operator. Reason: ${reason}`,
      `Original score: ${article.score}`,
      ...originalBreakdown.map(r => `Original: ${r}`)
    ];

    await prisma.curationLog.create({
      data: {
        title: article.title,
        url: article.url,
        source: article.source,
        topic: article.topic,
        status: "REMOVED",
        score: article.score ?? 0,
        breakdown: JSON.stringify(breakdown)
      }
    });

    // Provide a diagnostic adjustment tip
    const matchedKws = originalBreakdown
      .filter(r => r.includes("matched keyword") || r.includes("matched location keyword") || r.includes("bonus"))
      .map(r => {
        return r;
      });

    let confirmationMsg = `🗑️ **Article Removed.**\n`;
    confirmationMsg += `• **Title:** ${article.title}\n`;
    confirmationMsg += `• **Reason:** ${reason}\n`;
    if (matchedKws.length > 0) {
      confirmationMsg += `• **Original Matches:**\n`;
      for (const match of matchedKws) {
        confirmationMsg += `  └─ ${match}\n`;
      }
      confirmationMsg += `*Tip: Consider removing or refining these matching keywords/sources using \`/keyword remove\` or \`/source remove\`.*`;
    } else {
      confirmationMsg += `• *No original keywords/source bonuses recorded.*`;
    }

    console.log(`[Manual Removal Audit] Removed article "${article.title}" from topic "${article.topic}". Reason: "${reason}". Original breakdown: ${JSON.stringify(originalBreakdown)}`);

    await interaction.editReply({
      content: confirmationMsg
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply({
      content: `Failed to remove article: ${msg}`
    });
  }
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

export async function handleMergeToThreadCommand(
  interaction: MessageContextMenuCommandInteraction
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const messageId = interaction.targetMessage.id;

  // Verify the target child article exists in the database
  const article = await prisma.article.findFirst({
    where: { discordMessageId: messageId }
  });

  if (!article) {
    await interaction.reply({
      content: "Error: This message is not associated with an ingested article in the database.",
      ephemeral: true
    });
    return;
  }

  if (article.storyId) {
    const story = await prisma.story.findUnique({
      where: { id: article.storyId },
      include: { event: true }
    });
    if (story?.event?.discordThreadId === article.discordMessageId) {
      await interaction.reply({
        content: "Error: This article is already an active thread anchor. You cannot merge a thread anchor into another thread.",
        ephemeral: true
      });
      return;
    }
  }

  // Create the modal
  const modal = new ModalBuilder()
    .setCustomId(`merge-to-thread-modal_${messageId}`)
    .setTitle("Merge to Story Thread");

  const anchorInput = new TextInputBuilder()
    .setCustomId("anchorUrlOrId")
    .setLabel("Anchor Message Link or ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Paste the Discord link or ID of the parent article message");

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(anchorInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal);
}

export async function handleMergeToThreadModal(
  interaction: ModalSubmitInteraction,
  client: Client,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to perform this action.",
      ephemeral: true
    });
    return;
  }

  const customId = interaction.customId;
  const childMessageId = customId.split("_")[1];
  const anchorUrlOrId = interaction.fields.getTextInputValue("anchorUrlOrId");

  // Extract message ID
  const anchorMatch = anchorUrlOrId.match(/\/channels\/\d+\/\d+\/(\d+)/);
  const anchorMessageId = anchorMatch ? anchorMatch[1] : anchorUrlOrId.trim();

  try {
    await interaction.deferReply({ ephemeral: true });

    // Find the child article
    const childArticle = await prisma.article.findFirst({
      where: { discordMessageId: childMessageId }
    });

    if (!childArticle) {
      await interaction.editReply({
        content: "Error: Child article not found in database."
      });
      return;
    }

    // Find the anchor article
    const anchorArticle = await prisma.article.findFirst({
      where: { discordMessageId: anchorMessageId }
    });

    if (!anchorArticle) {
      await interaction.editReply({
        content: `Error: Anchor article not found in database for message ID: ${anchorMessageId}`
      });
      return;
    }

    if (anchorArticle.storyId) {
      const anchorStory = await prisma.story.findUnique({
        where: { id: anchorArticle.storyId },
        include: { event: true }
      });
      if (anchorStory?.event?.discordThreadId && anchorStory.event.discordThreadId !== anchorArticle.discordMessageId) {
        await interaction.editReply({
          content: "Error: The selected anchor is already a child of another thread. You can only merge into a parent anchor."
        });
        return;
      }
    }

    if (childArticle.id === anchorArticle.id && childArticle.topic === anchorArticle.topic) {
      await interaction.editReply({
        content: "Error: Cannot merge an article into itself."
      });
      return;
    }

    // Fetch anchor channel/message
    if (!anchorArticle.discordChannelId || !anchorArticle.discordMessageId) {
      await interaction.editReply({
        content: "Error: Anchor article is missing Discord channel or message metadata."
      });
      return;
    }

    const anchorChannel = await client.channels.fetch(anchorArticle.discordChannelId);
    if (!anchorChannel?.isTextBased()) {
      await interaction.editReply({
        content: "Error: Anchor Discord channel is not accessible or not text-based."
      });
      return;
    }

    const anchorMsg = await anchorChannel.messages.fetch(anchorArticle.discordMessageId);
    if (!anchorMsg) {
      await interaction.editReply({
        content: "Error: Anchor Discord message could not be fetched."
      });
      return;
    }

    let storyId = anchorArticle.storyId;
    let story: any = storyId ? await prisma.story.findUnique({ where: { id: storyId }, include: { event: true } }) : null;

    if (!story) {
      // Create a new Story for the anchor
      story = await prisma.story.create({
        data: {
          topic: anchorArticle.topic,
          title: anchorArticle.title,
        }
      });
      story = await prisma.story.findUnique({
        where: { id: story.id },
        include: { event: true }
      }) as any;
      storyId = story!.id;

      // Link the anchor article to the new story
      await prisma.article.update({
        where: { id_topic: { id: anchorArticle.id, topic: anchorArticle.topic } },
        data: { storyId }
      });
    }

    let threadId = story!.event?.discordThreadId;
    let thread: any;

    if (!threadId && story!.event) {
      // Create thread on anchor message
      const threadTitle = cleanThreadTitle(story!.event.title);
      thread = await anchorMsg.startThread({
        name: threadTitle,
        autoArchiveDuration: 1440 // 24 hours
      });
      threadId = thread.id;

      // Generate the initial Coverage Index message and pin it
      const eventWithStories = await prisma.event.findUnique({
        where: { id: story!.event.id },
        include: {
          stories: {
            where: { status: "OPEN" },
            include: {
              articles: {
                where: { status: { in: ["POSTED", "RELATED_COVERAGE"] } },
                orderBy: { publishedAt: "asc" }
              }
            }
          }
        }
      });

      const storiesList = eventWithStories?.stories || [];
      const indexEmbed = generateIndexEmbed(story!.event.title, storiesList, threadId!);
      const indexMsg = await thread.send({ embeds: [indexEmbed] });
      await indexMsg.pin().catch((err: any) => console.warn("Failed to pin index message:", err));

      // Update event in DB with the thread ID and index ID
      await setEventThreadAndIndex(story!.event!.id, threadId!, indexMsg.id);

      // Ping managers in the new thread
      const mentions = getManagerMentions();
      if (mentions) {
        await (thread as any).send({
          content: `🧵 New event thread created. Alert: ${mentions}`
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
    } else {
      thread = await client.channels.fetch(threadId!);
    }

    if (!thread) {
      await interaction.editReply({
        content: `Error: Failed to fetch or create thread (ID: ${threadId}).`
      });
      return;
    }

    // Format embed for child article
    const topicConfig = appConfig.topics[childArticle.topic];
    const embed = formatArticleEmbed({
      event: {
        id: childArticle.id,
        type: "news.article",
        title: `[${story!.title}] ${childArticle.title}`,
        url: childArticle.url ?? "",
        sourceName: childArticle.source,
        topic: childArticle.topic,
        publishedAt: childArticle.publishedAt?.toISOString(),
      },
      score: childArticle.score ?? 0,
      emoji: topicConfig?.emoji,
    });

    // Delete child message from main channel
    if (childArticle.discordChannelId && childArticle.discordMessageId) {
      const childChannel = await client.channels.fetch(childArticle.discordChannelId);
      if (childChannel?.isTextBased()) {
        const childMsg = await childChannel.messages.fetch(childArticle.discordMessageId).catch(() => null);
        if (childMsg) {
          await childMsg.delete().catch(err => console.warn("Failed to delete child message:", err));
        }
      }
    }

    // Post child embed inside thread
    const threadMsg = await (thread as any).send({ embeds: [embed] });

    // Update child article in DB
    await prisma.article.update({
      where: { id_topic: { id: childArticle.id, topic: childArticle.topic } },
      data: {
        storyId: story!.id,
        discordChannelId: thread.id,
        discordMessageId: threadMsg.id,
        status: ARTICLE_STATUSES.RELATED_COVERAGE,
        statusReason: "Manually merged by operator"
      }
    });

    // Update story's lastActivityAt
    await prisma.story.update({
      where: { id: story!.id },
      data: { lastActivityAt: new Date() }
    });

    // Update Event Index
    if (story!.event) {
      await updateEventIndex(client, story!.event.id);
    }

    await interaction.editReply({
      content: `✅ Successfully merged "${childArticle.title}" into thread under anchor "${anchorArticle.title}".`
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Error merging to thread:", error);
    await interaction.editReply({
      content: `Failed to merge to thread: ${msg}`
    });
  }
}

export async function handleRemoveFromThreadCommand(
  interaction: MessageContextMenuCommandInteraction,
  client: Client,
  appConfig: AppConfig
): Promise<void> {
  if (!isBotManager(interaction)) {
    await interaction.reply({
      content: "You do not have permission to run this command.",
      ephemeral: true
    });
    return;
  }

  const messageId = interaction.targetMessage.id;

  try {
    await interaction.deferReply({ ephemeral: true });

    // Verify child article exists in the database
    const childArticle = await prisma.article.findFirst({
      where: { discordMessageId: messageId }
    });

    if (!childArticle) {
      await interaction.editReply({
        content: "Error: This message is not associated with an ingested article in the database."
      });
      return;
    }

    if (!childArticle.storyId) {
      await interaction.editReply({
        content: "Error: This article is not associated with any story."
      });
      return;
    }

    const story = await prisma.story.findUnique({
      where: { id: childArticle.storyId },
      include: { event: true }
    });

    if (!story || !story.event?.discordThreadId || story.event.discordThreadId === childArticle.discordMessageId) {
      await interaction.editReply({
        content: "Error: This article is not a child inside a thread (it may be the anchor or has no thread)."
      });
      return;
    }

    // Delete message inside thread
    if (childArticle.discordChannelId && childArticle.discordMessageId) {
      const threadChannel = await client.channels.fetch(childArticle.discordChannelId);
      if (threadChannel?.isTextBased()) {
        const threadMsg = await threadChannel.messages.fetch(childArticle.discordMessageId).catch(() => null);
        if (threadMsg) {
          await threadMsg.delete().catch(err => console.warn("Failed to delete thread message during split:", err));
        }
      }
    }

    // Repost article in main channel
    const topicConfig = appConfig.topics[childArticle.topic];
    if (!topicConfig?.channelId) {
      await interaction.editReply({
        content: `Error: Topic "${childArticle.topic}" config has no destination channelId.`
      });
      return;
    }

    const mainChannel = await client.channels.fetch(topicConfig.channelId);
    if (!mainChannel?.isTextBased()) {
      await interaction.editReply({
        content: `Error: Main destination channel is not text-based.`
      });
      return;
    }

    const embed = formatArticleEmbed({
      event: {
        id: childArticle.id,
        type: "news.article",
        title: childArticle.title,
        url: childArticle.url ?? "",
        sourceName: childArticle.source,
        topic: childArticle.topic,
        publishedAt: childArticle.publishedAt?.toISOString(),
      },
      score: childArticle.score ?? 0,
      emoji: topicConfig.emoji
    });

    const newMsg = await (mainChannel as any).send({ embeds: [embed] });

    // Update child article in database
    await prisma.article.update({
      where: { id_topic: { id: childArticle.id, topic: childArticle.topic } },
      data: {
        storyId: null,
        discordChannelId: topicConfig.channelId,
        discordMessageId: newMsg.id,
        status: ARTICLE_STATUSES.POSTED,
        statusReason: "Manually split from thread by operator"
      }
    });

    // Update Event Index
    if (story.event) {
      await updateEventIndex(client, story.event.id);
    }

    await interaction.editReply({
      content: `✅ Successfully split "${childArticle.title}" out of thread and reposted in main channel.`
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Error splitting from thread:", error);
    await interaction.editReply({
      content: `Failed to split from thread: ${msg}`
    });
  }
}












