import { EmbedBuilder, type Client } from "discord.js";
import { prisma } from "../storage/prismaClient.js";

/**
 * Generates the Markdown index list and returns a formatted Discord Embed.
 */
export function generateIndexEmbed(
  eventTitle: string,
  stories: Array<{
    title: string;
    articles: Array<{
      title: string;
      source: string;
      score: number | null;
      discordMessageId: string | null;
    }>;
  }>,
  threadId: string
): EmbedBuilder {
  const guildId = process.env.DISCORD_GUILD_ID || "@me";
  
  const embed = new EmbedBuilder()
    .setTitle(`📌 Coverage Index: ${eventTitle}`)
    .setColor(0x5865F2); // Premium Discord Blurple

  const lines: string[] = [];

  for (const story of stories) {
    // Filter out articles that don't have discordMessageId to prevent displaying unposted/indexed items in the index
    const postedArticles = story.articles.filter(art => art.discordMessageId !== null);
    if (postedArticles.length === 0) continue;
    
    lines.push(`\n**Story: ${story.title}**`);
    
    for (const art of postedArticles) {
      const escapedTitle = art.title.replace(/\[/g, "\\[").replace(/\]/g, "\\]"); // escape markdown brackets
      const scoreStr = art.score !== null ? ` (Score: ${art.score})` : "";
      
      const jumpLink = `https://discord.com/channels/${guildId}/${threadId}/${art.discordMessageId}`;
      const linkText = `[${escapedTitle}](${jumpLink})`;
      
      lines.push(`• ${linkText} - *${art.source}*${scoreStr}`);
    }
  }

  let description = lines.join("\n");
  if (description.length > 4000) {
    description = description.slice(0, 4000) + "\n...and more.";
  }

  if (description.trim().length === 0) {
    description = "No active stories grouped under this event yet.";
  }

  embed.setDescription(description);
  return embed;
}

/**
 * Queries the database, generates the coverage index embed, and updates the pinned message in Discord.
 */
export async function updateEventIndex(client: Client, eventId: string): Promise<void> {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        stories: {
          where: { status: "OPEN" },
          include: {
            articles: {
              where: { status: { in: ["POSTED", "RELATED_COVERAGE"] } },
              orderBy: { publishedAt: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!event || !event.discordThreadId || !event.indexMessageId) {
      return;
    }

    const embed = generateIndexEmbed(event.title, event.stories, event.discordThreadId);

    const threadChannel = await client.channels.fetch(event.discordThreadId).catch(() => null);
    if (threadChannel) {
      let indexMsg = null;
      // Try to fetch the index message from the parent channel (new thread-on-index anchor style)
      if (threadChannel.isThread() && threadChannel.parent) {
        indexMsg = await (threadChannel.parent as any).messages.fetch(event.indexMessageId).catch(() => null);
      }
      // Fallback: fetch from within the channel/thread itself (legacy style)
      if (!indexMsg && threadChannel.isTextBased()) {
        indexMsg = await threadChannel.messages.fetch(event.indexMessageId).catch(() => null);
      }

      if (indexMsg) {
        await indexMsg.edit({ embeds: [embed] }).catch((err: any) => {
          console.error(`[Index Manager] Failed to edit index message ${event.indexMessageId}:`, err);
        });
      }
    }
  } catch (error) {
    console.error(`[Index Manager] Error updating index for event ${eventId}:`, error);
  }
}
