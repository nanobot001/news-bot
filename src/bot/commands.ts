import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody
} from "discord.js";

export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check whether the news bot is running.");

export function getCommandRegistrationPayloads(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [pingCommand.toJSON()];
}

export async function handlePingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    content: "Pong. News bot shell is running.",
    ephemeral: true
  });
}
