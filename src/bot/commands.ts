import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type Client
} from "discord.js";
import { type AppConfig, reloadAppConfig } from "../config/loadConfig.js";
import { getRecentlyPostedArticles } from "../storage/articleRepo.js";
import { pollNews } from "../jobs/pollNews.js";
import { prisma } from "../storage/prismaClient.js";

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
  .setDescription("Show recently posted articles for a specific topic.")
  .addStringOption(option =>
    option.setName("topic")
      .setDescription("The topic to retrieve")
      .setRequired(true)
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
    sourcesCommand.toJSON()
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
    const articles = await getRecentlyPostedArticles(topic, 10);

    if (articles.length === 0) {
      await interaction.editReply({
        content: `No recently posted articles found for topic: "${topic}".`
      });
      return;
    }

    let responseText = `**Recently posted articles for topic: "${topic}"**\n\n`;
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const timeStr = art.postedAt ? `<t:${Math.floor(art.postedAt.getTime() / 1000)}:R>` : "unknown time";
      const link = art.url ? `[${art.title}](${art.url})` : art.title;
      const scoreStr = art.score !== null ? `(Score: ${art.score})` : "";
      const line = `${i + 1}. ${link} ${scoreStr} - Posted ${timeStr}\n`;

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
      content: `Failed to fetch recently posted articles: ${msg}`
    });
  }
}

export async function handleReloadconfigCommand(
  interaction: ChatInputCommandInteraction,
  appConfig: AppConfig
): Promise<void> {
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
      const statusStr = art.postedAt ? "✅ Posted" : "❌ Skipped";
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
      responseText += `  * Threshold: \`${settings.postThreshold}\`\n`;
      responseText += `  * Keywords (${settings.keywords.length}): ${settings.keywords.map(k => `\`${k}\``).join(", ") || "*None*"}\n`;
      if (settings.blockedTerms && settings.blockedTerms.length > 0) {
        responseText += `  * Blocked Terms (${settings.blockedTerms.length}): ${settings.blockedTerms.map(b => `\`${b}\``).join(", ")}\n`;
      }
      responseText += `\n`;
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

