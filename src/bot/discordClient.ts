import { Client, GatewayIntentBits } from "discord.js";

export type DiscordClientConfig = {
  token: string;
  clientId: string;
  guildId?: string;
};

export function createDiscordClientConfigFromEnv(): DiscordClientConfig {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token) {
    throw new Error("Missing required environment value: DISCORD_TOKEN");
  }

  if (!clientId) {
    throw new Error("Missing required environment value: DISCORD_CLIENT_ID");
  }

  return {
    token,
    clientId,
    guildId: process.env.DISCORD_GUILD_ID
  };
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds]
  });
}
