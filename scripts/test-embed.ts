import "dotenv/config";
import { ChannelType, Events } from "discord.js";
import { createDiscordClient, createDiscordClientConfigFromEnv } from "../src/bot/discordClient.js";
import { formatArticleEmbed, postArticleToChannel } from "../src/bot/postEmbed.js";
import { loadAppConfig } from "../src/config/loadConfig.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

async function main(): Promise<void> {
  const discordConfig = createDiscordClientConfigFromEnv();
  const appConfig = await loadAppConfig();
  const client = createDiscordClient();

  console.log("Logging into Discord to run manual verification...");

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      console.log(`Connected as ${readyClient.user.tag}.`);

      // 1. Determine target channel ID
      let channelId = appConfig.topics.anime?.channelId;
      console.log(`Topic 'anime' channel configured as: '${channelId}'`);

      if (!channelId || channelId === "DISCORD_CHANNEL_ID_HERE") {
        console.log("Placeholder channel ID detected. Attempting fallbacks...");
        
        if (process.env.DISCORD_CHANNEL_ID) {
          channelId = process.env.DISCORD_CHANNEL_ID;
          console.log(`Using fallback from process.env.DISCORD_CHANNEL_ID: '${channelId}'`);
        } else {
          console.log("No specific channel configured. Resolving guild list...");
          const guilds = await readyClient.guilds.fetch();
          
          if (guilds.size === 0) {
            throw new Error("The bot is not connected to any guilds/servers. Please invite the bot first.");
          }

          let targetGuild = null;
          // Try guildId from config if present
          if (discordConfig.guildId) {
            try {
              targetGuild = await readyClient.guilds.fetch(discordConfig.guildId);
            } catch (err) {
              console.log(`Failed to fetch configured guild '${discordConfig.guildId}'. Trying first available guild...`);
            }
          }

          if (!targetGuild) {
            const firstGuildOAuth2 = guilds.first();
            if (firstGuildOAuth2) {
              targetGuild = await readyClient.guilds.fetch(firstGuildOAuth2.id);
            }
          }

          if (!targetGuild) {
            throw new Error("Could not fetch any guild details.");
          }

          console.log(`Using target guild: '${targetGuild.name}' (ID: ${targetGuild.id})`);
          const channels = await targetGuild.channels.fetch();
          
          const firstTextChannel = channels.find(
            (c) => c !== null && c.type === ChannelType.GuildText
          );

          if (!firstTextChannel) {
            throw new Error(`Could not find any text channels in guild '${targetGuild.name}'`);
          }

          channelId = firstTextChannel.id;
          console.log(`Using fallback text channel: '#${firstTextChannel.name}' (ID: ${channelId})`);
        }
      }

      // 2. Format a sample normalized article event
      const sampleEvent: NormalizedEvent = {
        id: `test-verification-${Date.now()}`,
        type: "news.article",
        topic: "anime",
        title: "Test Embed: News Bot is Rocking and Rolling!",
        url: "https://github.com/google-deepmind",
        sourceName: "DeepMind RSS Feed",
        publishedAt: new Date().toISOString(),
        summary: "This is a live manual verification message sent by the automated build agent to confirm that Discord embeds render perfectly in target channels.",
      };

      const score = 88;
      console.log(`Formatting embed for article: '${sampleEvent.title}' with score ${score}...`);
      const embed = formatArticleEmbed({ event: sampleEvent, score });

      // 3. Post embed
      console.log(`Posting embed to channel ID: '${channelId}'...`);
      await postArticleToChannel(readyClient, channelId, embed);
      
      console.log("Post successful!");
      process.exit(0);
    } catch (error) {
      console.error("Verification script failed during execution:", error);
      process.exit(1);
    }
  });

  await client.login(discordConfig.token);
}

main().catch((error) => {
  console.error("Verification script startup failed:", error);
  process.exit(1);
});
