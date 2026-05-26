import "dotenv/config";

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
});

import { Events, REST, Routes } from "discord.js";

import {
  getCommandRegistrationPayloads,
  handlePingCommand,
  handleTestfeedCommand,
  handleLastpostsCommand,
  handleReloadconfigCommand,
  handleRefreshCommand,
  handleStatsCommand,
  handleSearchCommand,
  handleTopicsCommand,
  handleSourcesCommand,
  handleFavoritesCommand,
  handleUnfavoriteCommand,
  handleAuditCommand,
  handleTopicCommand,
  handleSourceCommand,
  handleKeywordCommand,
  handleRemoveArticleCommand,
  handleRemoveArticleModal,
  handleMergeToThreadCommand,
  handleMergeToThreadModal,
  handleSplitFromThreadCommand
} from "./bot/commands.js";
import { getFavorites } from "./storage/articleRepo.js";
import { createDiscordClient, createDiscordClientConfigFromEnv } from "./bot/discordClient.js";
import { loadAppConfig } from "./config/loadConfig.js";
import { startScheduler, runSinglePoll } from "./jobs/pollNews.js";
import { registerReactionListener } from "./bot/reactionListener.js";

async function main(): Promise<void> {
  const discordConfig = createDiscordClientConfigFromEnv();
  const appConfig = await loadAppConfig();
  const commandPayloads = getCommandRegistrationPayloads();
  const client = createDiscordClient();

  registerReactionListener(client);


  client.on(Events.Error, (error) => {
    console.error(`[Discord Client] Error:`, error);
  });

  client.on(Events.Warn, (info) => {
    console.warn(`[Discord Client] Warning:`, info);
  });

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
    // Handle Autocomplete Interactions
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "unfavorite") {
        try {
          const focusedValue = interaction.options.getFocused();
          const favorites = await getFavorites(interaction.user.id, {
            query: focusedValue || undefined,
            limit: 25
          });
          const choices = favorites.map(fav => {
            let name = `[${fav.articleTopic}] ${fav.article.title}`;
            if (name.length > 100) {
              name = name.slice(0, 97) + "...";
            }
            return { name, value: fav.id };
          });
          await interaction.respond(choices);
        } catch (error) {
          console.error("[Autocomplete] Error serving unfavorite choices:", error);
          try {
            await interaction.respond([]);
          } catch (_) {}
        }
      } else {
        try {
          const focusedOption = interaction.options.getFocused(true);
          if (focusedOption.name === "topic") {
            const focusedValue = focusedOption.value.toLowerCase();
            const configuredTopics = Object.keys(appConfig.topics);
            const choices = configuredTopics
              .filter(topic => topic.toLowerCase().includes(focusedValue))
              .map(topic => ({ name: topic, value: topic }))
              .slice(0, 25);
            await interaction.respond(choices);
          } else if (focusedOption.name === "keyword" && interaction.commandName === "keyword") {
            const topic = interaction.options.getString("topic") || "";
            const type = interaction.options.getString("type") || "standard";
            const topicConfig = appConfig.topics[topic];
            if (topicConfig) {
              const keywords = type === "standard" 
                ? (topicConfig.keywords || []) 
                : (type === "location" 
                  ? (topicConfig.locationKeywords || []) 
                  : (topicConfig.blockedTerms || []));
              const focusedValue = focusedOption.value.toLowerCase();
              const choices = keywords
                .filter(k => k.toLowerCase().includes(focusedValue))
                .map(k => ({ name: k, value: k }))
                .slice(0, 25);
              await interaction.respond(choices);
            } else {
              await interaction.respond([]);
            }
          } else {
            await interaction.respond([]);
          }
        } catch (error) {
          console.error(`[Autocomplete] Error serving autocomplete choices:`, error);
          try {
            await interaction.respond([]);
          } catch (_) {}
        }
      }
      return;
    }

    // Handle Context Menu Interactions
    if (interaction.isMessageContextMenuCommand()) {
      if (interaction.commandName === "Remove Article") {
        await handleRemoveArticleCommand(interaction);
      } else if (interaction.commandName === "Merge to Thread") {
        await handleMergeToThreadCommand(interaction);
      } else if (interaction.commandName === "Split from Thread") {
        await handleSplitFromThreadCommand(interaction, client, appConfig);
      }
      return;
    }

    // Handle Modal Submit Interactions
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("remove-article-modal_")) {
        await handleRemoveArticleModal(interaction, client);
      } else if (interaction.customId.startsWith("merge-to-thread-modal_")) {
        await handleMergeToThreadModal(interaction, client, appConfig);
      }
      return;
    }

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
    } else if (interaction.commandName === "refresh") {
      await handleRefreshCommand(interaction, client, appConfig);
    } else if (interaction.commandName === "stats") {
      await handleStatsCommand(interaction, appConfig);
    } else if (interaction.commandName === "search") {
      await handleSearchCommand(interaction, appConfig);
    } else if (interaction.commandName === "topics") {
      await handleTopicsCommand(interaction, appConfig);
    } else if (interaction.commandName === "sources") {
      await handleSourcesCommand(interaction, appConfig);
    } else if (interaction.commandName === "favorites") {
      await handleFavoritesCommand(interaction, appConfig);
    } else if (interaction.commandName === "unfavorite") {
      await handleUnfavoriteCommand(interaction, appConfig);
    } else if (interaction.commandName === "audit") {
      await handleAuditCommand(interaction, appConfig);
    } else if (interaction.commandName === "topic") {
      await handleTopicCommand(interaction, appConfig);
    } else if (interaction.commandName === "source") {
      await handleSourceCommand(interaction, appConfig);
    } else if (interaction.commandName === "keyword") {
      await handleKeywordCommand(interaction, appConfig);
    }
  });


  await client.login(discordConfig.token);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Startup failed: ${message}`);
  process.exitCode = 1;
});

