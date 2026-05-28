import { EmbedBuilder, type Client, type TextBasedChannel, type Message } from "discord.js";
import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export type ArticleEmbedInput = {
  event: NormalizedEvent;
  score: number;
  emoji?: string;
};

/**
 * Helper to extract YouTube video ID from a URL
 */
function extractYoutubeVideoId(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
      // Handle youtube.com/watch?v=ID
      if (url.searchParams.has("v")) {
        return url.searchParams.get("v");
      }
      // Handle youtube.com/embed/ID or youtube.com/v/ID or youtube.com/shorts/ID
      const pathParts = url.pathname.split("/");
      const shortsIndex = pathParts.indexOf("shorts");
      if (shortsIndex !== -1 && pathParts[shortsIndex + 1]) {
        return pathParts[shortsIndex + 1];
      }
      const embedIndex = pathParts.indexOf("embed");
      if (embedIndex !== -1 && pathParts[embedIndex + 1]) {
        return pathParts[embedIndex + 1];
      }
      // Handle youtu.be/ID
      if (url.hostname.includes("youtu.be")) {
        return pathParts[1] || null;
      }
    }
  } catch {
    // Ignore URL parsing errors
  }
  return null;
}

/**
 * Formats a normalized article event into a rich Discord Embed.
 */
export function formatArticleEmbed(input: ArticleEmbedInput): EmbedBuilder {
  const { event, score, emoji } = input;
  const isFromReddit = 
    (event.sourceName && event.sourceName.toLowerCase().includes("reddit")) ||
    (event.url && event.url.toLowerCase().includes("reddit.com"));
  const displayTitle = (event.author && !isFromReddit) ? `[${event.author}] ${event.title}` : event.title;
  const title = emoji ? `${emoji} ${displayTitle}` : displayTitle;
  
  const embed = new EmbedBuilder()
    .setTitle(title)
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

  if (event.imageUrl) {
    embed.setImage(event.imageUrl);
  } else {
    const ytVideoId = extractYoutubeVideoId(event.url);
    if (ytVideoId) {
      embed.setImage(`https://img.youtube.com/vi/${ytVideoId}/hqdefault.jpg`);
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
): Promise<Message> {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel not found in Discord: ${channelId}`);
  }
  if (!channel.isTextBased()) {
    throw new Error(`Channel is not text-based: ${channelId}`);
  }
  return await (channel as any).send({ embeds: [embed] });
}
