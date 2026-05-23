import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type Client
} from "discord.js";
import { type AppConfig, reloadAppConfig } from "../config/loadConfig.js";
import { getRecentlyPostedArticles } from "../storage/articleRepo.js";
import { pollNews } from "../jobs/pollNews.js";

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

export function getCommandRegistrationPayloads(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [
    pingCommand.toJSON(),
    testfeedCommand.toJSON(),
    lastpostsCommand.toJSON(),
    reloadconfigCommand.toJSON()
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
        responseText += `\n*...and ${articles.length - i} more items (truncated due to Discord limit).*`;
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
