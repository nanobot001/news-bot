import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AttachmentBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type Client
} from "discord.js";
import { type AppConfig, reloadAppConfig } from "../config/loadConfig.js";
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
    auditCommand.toJSON()
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
      responseText += `- **${topic}**\n`;
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


