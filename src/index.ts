import "dotenv/config";

import { Events } from "discord.js";

import { getCommandRegistrationPayloads, handlePingCommand } from "./bot/commands.js";
import { createDiscordClient, createDiscordClientConfigFromEnv } from "./bot/discordClient.js";
import { loadAppConfig } from "./config/loadConfig.js";
import { startScheduler, runSinglePoll } from "./jobs/pollNews.js";

async function main(): Promise<void> {
  const discordConfig = createDiscordClientConfigFromEnv();
  const appConfig = await loadAppConfig();
  const commandPayloads = getCommandRegistrationPayloads();
  const client = createDiscordClient();

  console.log(
    `Starting Discord news bot shell with ${Object.keys(appConfig.topics).length} topics, ${Object.values(appConfig.sources).flat().length} sources, and ${commandPayloads.length} command payload.`
  );

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Discord news bot shell connected as ${readyClient.user.tag}.`);
    console.log(
      `Loaded ${Object.keys(appConfig.topics).length} topics, ${Object.values(appConfig.sources).flat().length} sources, and ${commandPayloads.length} command payload.`
    );

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
    }
  });

  await client.login(discordConfig.token);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Startup failed: ${message}`);
  process.exitCode = 1;
});
