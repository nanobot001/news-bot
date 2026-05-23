import { EmbedBuilder, type Client, type TextBasedChannel } from "discord.js";
import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export type ArticleEmbedInput = {
  event: NormalizedEvent;
  score: number;
};

/**
 * Formats a normalized article event into a rich Discord Embed.
 */
export function formatArticleEmbed(input: ArticleEmbedInput): EmbedBuilder {
  const { event, score } = input;
  
  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setURL(event.url)
    .setAuthor({ name: event.sourceName })
    .setColor(0x5865F2); // Premium Discord Blurple

  if (event.summary && event.summary.trim().length > 0) {
    embed.setDescription(event.summary.trim());
  }

  if (event.publishedAt) {
    const parsedDate = new Date(event.publishedAt);
    if (!isNaN(parsedDate.getTime())) {
      embed.setTimestamp(parsedDate);
    }
  }

  if (process.env.NODE_ENV === "development") {
    embed.setFooter({
      text: `Score: ${score} | Topic: ${event.topic} (Dev Mode)`
    });
  }

  return embed;
}

/**
 * Posts the formatted embed to the specified Discord channel.
 */
export async function postArticleToChannel(
  client: Client,
  channelId: string,
  embed: EmbedBuilder
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel not found in Discord: ${channelId}`);
  }
  if (!channel.isTextBased()) {
    throw new Error(`Channel is not text-based: ${channelId}`);
  }
  await (channel as any).send({ embeds: [embed] });
}
