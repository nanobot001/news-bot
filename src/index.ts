import "dotenv/config";

import { Events, REST, Routes } from "discord.js";

import {
  getCommandRegistrationPayloads,
  handlePingCommand,
  handleTestfeedCommand,
  handleLastpostsCommand,
  handleReloadconfigCommand
} from "./bot/commands.js";
import { createDiscordClient, createDiscordClientConfigFromEnv } from "./bot/discordClient.js";
import { loadAppConfig } from "./config/loadConfig.js";
import { startScheduler, runSinglePoll } from "./jobs/pollNews.js";

async function main(): Promise<void> {
  const discordConfig = createDiscordClientConfigFromEnv();
  const appConfig = await loadAppConfig();
  const commandPayloads = getCommandRegistrationPayloads();
  const client = createDiscordClient();

  console.log(
    `Starting Discord news bot shell with ${Object.keys(appConfig.topics).length} topics, ${Object.values(appConfig.sources).flat().length} sources, and ${commandPayloads.length} command payloads.`
  );

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord news bot shell connected as ${readyClient.user.tag}.`);
    console.log(
      `Loaded ${Object.keys(appConfig.topics).length} topics, ${Object.values(appConfig.sources).flat().length} sources, and ${commandPayloads.length} command payloads.`
    );

    // Register Slash Commands if Guild ID is provided (mitigated on startup)
    if (discordConfig.guildId) {
      console.log(`Registering slash commands to Guild ID: ${discordConfig.guildId}...`);
      const rest = new REST({ version: "10" }).setToken(discordConfig.token);
      try {
        await rest.put(
          Routes.applicationGuildCommands(discordConfig.clientId, discordConfig.guildId),
          { body: commandPayloads }
        );
        console.log("Successfully registered slash commands.");
      } catch (error) {
        console.error(
          `Failed to register slash commands: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Initialize the scheduler
    try {
      startScheduler(readyClient, appConfig);
    } catch (schedulerError) {
      console.error(`Failed to start scheduler: ${schedulerError instanceof Error ? schedulerError.message : String(schedulerError)}`);
    }

    // Trigger immediate run if requested in development mode
    if (process.env.RUN_IMMEDIATE === "true" && process.env.NODE_ENV === "development") {
      console.log("[News Poll] RUN_IMMEDIATE is set. Running initial poll immediately...");
      try {
        await runSinglePoll(readyClient, appConfig);
      } catch (pollError) {
        console.error(`Initial poll run failed: ${pollError instanceof Error ? pollError.message : String(pollError)}`);
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "ping") {
      await handlePingCommand(interaction);
    } else if (interaction.commandName === "testfeed") {
      await handleTestfeedCommand(interaction, client, appConfig);
    } else if (interaction.commandName === "lastposts") {
      await handleLastpostsCommand(interaction, appConfig);
    } else if (interaction.commandName === "reload-config") {
      await handleReloadconfigCommand(interaction, appConfig);
    }
  });

  await client.login(discordConfig.token);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Startup failed: ${message}`);
  process.exitCode = 1;
});

