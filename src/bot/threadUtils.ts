import { EmbedBuilder, type Client } from "discord.js";
import { cleanThreadTitle } from "../processing/similarity.js";

type TextSendableChannel = {
  id: string;
  isTextBased?: () => boolean;
  send: (payload: unknown) => Promise<any>;
};

async function resolveThreadStarterChannel(client: Client, channelId: string): Promise<TextSendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null) as any;
  if (!channel) {
    return null;
  }

  if (channel.isThread?.()) {
    const parent = channel.parent ?? (channel.parentId ? await client.channels.fetch(channel.parentId).catch(() => null) : null);
    if (parent?.isTextBased?.()) {
      return parent as TextSendableChannel;
    }
    return null;
  }

  if (channel.isTextBased?.()) {
    return channel as TextSendableChannel;
  }

  return null;
}

export async function createCoverageIndexThread(
  client: Client,
  anchorChannelId: string,
  eventTitle: string
): Promise<{ thread: any; threadId: string; indexMessageId: string }> {
  const starterChannel = await resolveThreadStarterChannel(client, anchorChannelId);
  if (!starterChannel) {
    throw new Error(`Could not resolve a parent text channel for ${anchorChannelId}`);
  }

  const initialEmbed = new EmbedBuilder()
    .setTitle(`📌 Coverage Index: ${eventTitle}`)
    .setColor(0x5865F2)
    .setDescription("Initializing coverage thread index...");

  const indexMsg = await starterChannel.send({ embeds: [initialEmbed] });
  await indexMsg.pin().catch((err: any) => console.warn("Failed to pin index message:", err));

  try {
    const threadTitle = cleanThreadTitle(eventTitle);
    const thread = await indexMsg.startThread({
      name: threadTitle,
      autoArchiveDuration: 1440,
    });

    return {
      thread,
      threadId: thread.id,
      indexMessageId: indexMsg.id,
    };
  } catch (error) {
    await indexMsg.unpin?.().catch(() => null);
    await indexMsg.delete?.().catch((deleteErr: any) => {
      console.warn("Failed to delete unused coverage index message after thread creation failed:", deleteErr);
    });
    throw error;
  }
}
