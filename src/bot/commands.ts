import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type Client
} from "discord.js";
import { type AppConfig, reloadAppConfig, saveTopicsConfig, saveSourcesConfig } from "../config/loadConfig.js";
import { getArticlesForTopic, getFavorites, deleteFavoriteById, getCurationLogs } from "../storage/articleRepo.js";
import { pollNews } from "../jobs/pollNews.js";
import { prisma } from "../storage/prismaClient.js";
import { formatArticleStatus } from "../storage/articleStatus.js";
import { isBotManager } from "./auth.js";

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
  );

export const lastpostsCommand = new SlashCommandBuilder()
  .setName("lastposts")
  .setDescription("Show recently ingested articles for a specific topic.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The topic to retrieve")
      .setRequired(true)
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

export const refreshCommand = new SlashCommandBuilder()
  .setName("refresh")
  .setDescription("Run a live feed check and post eligible articles to Discord.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The specific topic to refresh (optional)")
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
  );

export const favoritesCommand = new SlashCommandBuilder()
  .setName("favorites")
  .setDescription("Recall your personal favorited news articles.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("Filter by a specific topic (optional)")
      .setRequired(false)
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
    option.setName("status")
      .setDescription("Filter by curation status (optional)")
      .setRequired(false)
      .addChoices(
        { name: "POSTED", value: "POSTED" },
        { name: "SKIPPED_THRESHOLD", value: "SKIPPED_THRESHOLD" },
        { name: "SKIPPED_BLOCKED", value: "SKIPPED_BLOCKED" },
        { name: "DEFERRED_COOLDOWN", value: "DEFERRED_COOLDOWN" }
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

export function getCommandRegistrationPayloads(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    pingCommand.toJSON(),
    testfeedCommand.toJSON(),
    lastpostsCommand.toJSON(),
    reloadconfigCommand.toJSON(),
    refreshCommand.toJSON(),
    statsCommand.toJSON(),
    searchCommand.toJSON(),
    topicsCommand.toJSON(),
    sourcesCommand.toJSON(),
    favoritesCommand.toJSON(),
    unfavoriteCommand.toJSON(),
    auditCommand.toJSON(),
    topicCommand.toJSON(),
    sourceCommand.toJSON()
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
    responseText += `- Feeds checked: ${numFeeds}\n`;
    responseText += `- Items found in feed: ${topicCounts.checked}\n`;
    responseText += `- New items (not in database): ${topicCounts.newItems}\n`;
    responseText += `- Posts eligible (above threshold): ${topicCounts.eligible ?? 0}\n`;

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

export async function handleRefreshCommand(
  interaction: ChatInputCommandInteraction,
  client: Client,
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

    const errorsList: Array<{ topic: string; source: string; message: string }> = [];
    const countsMap = await pollNews(client, appConfig, errorsList, topic ?? undefined, false);

    let responseText = `**Feed Refresh Complete**\n\n`;
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
      where: { postedAt: { not: null } }
    });
    const skippedCount = totalCount - postedCount;

    const topicStats = await prisma.article.groupBy({
      by: ["topic"],
      _count: {
        _all: true
      }
    });

    const topicPostedStats = await prisma.article.groupBy({
      by: ["topic"],
      where: { postedAt: { not: null } },
      _count: {
        _all: true
      }
    });

    let responseText = `**Operational Statistics**\n`;
    responseText += `- Total Indexed Articles: **${totalCount}**\n`;
    responseText += `- Total Posted to Discord: **${postedCount}**\n`;
    responseText += `- Total Skipped/Deduplicated: **${skippedCount}**\n\n`;

    responseText += `**Topic Indexing Breakdown:**\n`;
    const configuredTopics = Object.keys(appConfig.topics);
    for (const t of configuredTopics) {
      const totalForTopic = topicStats.find((s) => s.topic === t)?._count._all ?? 0;
      const postedForTopic = topicPostedStats.find((s) => s.topic === t)?._count._all ?? 0;
      const skippedForTopic = totalForTopic - postedForTopic;
      responseText += `- **${t}**: Total: ${totalForTopic} | Posted: ${postedForTopic} | Skipped: ${skippedForTopic}\n`;
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

      const maxKeywordsToShow = 10;
      let keywordsStr = settings.keywords.slice(0, maxKeywordsToShow).map(k => `\`${k}\``).join(", ");
      if (settings.keywords.length > maxKeywordsToShow) {
        keywordsStr += `, ... and ${settings.keywords.length - maxKeywordsToShow} more`;
      }
      responseText += `  * Keywords (${settings.keywords.length}): ${keywordsStr || "*None*"}\n`;

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

    let responseText = `**Configured RSS Sources**\n\n`;
    const targetTopics = topic ? [topic] : Object.keys(appConfig.sources);

    for (const t of targetTopics) {
      const feeds = appConfig.sources[t] || [];
      responseText += `**Topic: ${t}** (${feeds.length} feeds):\n`;
      for (const feed of feeds) {
        const trustedStr = feed.trusted ? " 🌟(trusted)" : "";
        const line = `- _${feed.name}_: <${feed.url}>${trustedStr}\n`;

        if (responseText.length + line.length > 1950) {
          responseText += `\n*...list truncated due to Discord limit.*`;
          break;
        }
        responseText += line;
      }
      responseText += `\n`;
    }

    await interaction.editReply({ content: responseText });
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
      status: status ?? undefined
    });

    if (logs.length === 0) {
      await interaction.editReply({
        content: `No curation logs found for topic: "${topic}" matching filters.`
      });
      return;
    }

    let outputText = `**Curation Audit Logs for topic: "${topic}"** (showing ${logs.length} items):\n\n`;
    let fileText = `=========================================\n`;
    fileText += `CURATION AUDIT LOGS FOR TOPIC: ${topic.toUpperCase()}\n`;
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

      const statusPrefix = log.status === "POSTED" ? "✅ [POSTED]" : `❌ [${log.status}]`;
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

    if (outputText.length > 1950 || limit > 15) {
      const buffer = Buffer.from(fileText, "utf-8");
      const attachment = new AttachmentBuilder(buffer, { name: `audit-log-${topic}.txt` });
      await interaction.editReply({
        content: `Audit log list is too long for a Discord message, or a large limit was requested. Attached is the full log text file for **${topic}** (${logs.length} entries).`,
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

    const content = `### Topic Lane: **${topic}** (${status})\n` +
      `- **Channel:** <#${config.channelId}>\n` +
      `- **Post Threshold:** ${config.postThreshold}\n` +
      `- **Emoji Prefix:** ${emojiPrefix}\n` +
      `- **Keywords (${config.keywords.length}):** ${config.keywords.join(", ") || "none"}\n` +
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

    const list = sources.map(s => {
      const trustWord = s.trusted ? "⭐ [TRUSTED]" : "❌ [UNTRUSTED]";
      return `• **${s.name}** - ${trustWord} - <${s.url}>`;
    });

    await interaction.reply({
      content: `### Sources for Topic lane **${topic}**:\n${list.join("\n")}`,
      ephemeral: true
    });
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



