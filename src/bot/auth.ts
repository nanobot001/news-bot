import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionsBitField } from "discord.js";

/**
 * Checks if the user invoking the interaction is authorized as a bot manager.
 * 
 * Authorization gates:
 * 1. User ID is present in the comma-separated `BOT_MANAGER_USER_IDS` env var.
 * 2. Member possesses a role present in the comma-separated `BOT_MANAGER_ROLE_IDS` env var.
 * 3. Fallback: If both user and role list are empty, check if the user has the ManageGuild permission.
 */
export function isBotManager(interaction: ChatInputCommandInteraction): boolean {
  const managerUserIdsStr = process.env.BOT_MANAGER_USER_IDS || "";
  const managerRoleIdsStr = process.env.BOT_MANAGER_ROLE_IDS || "";

  const managerUserIds = managerUserIdsStr
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const managerRoleIds = managerRoleIdsStr
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  // 1. Check user ID
  if (managerUserIds.includes(interaction.user.id)) {
    return true;
  }

  // 2. Check roles (checking cache collection and raw array)
  if (interaction.member && "roles" in interaction.member) {
    const roles = interaction.member.roles;
    if (typeof roles === "object" && roles !== null && "cache" in roles) {
      const memberRoleCache = roles.cache as Map<string, any>;
      const hasRole = managerRoleIds.some((roleId) => memberRoleCache.has(roleId));
      if (hasRole) {
        return true;
      }
    } else if (Array.isArray(roles)) {
      const hasRole = managerRoleIds.some((roleId) => (roles as string[]).includes(roleId));
      if (hasRole) {
        return true;
      }
    }
  }

  // 3. Fallback check: ManageGuild permission if no lists configured
  if (managerUserIds.length === 0 && managerRoleIds.length === 0) {
    if (interaction.memberPermissions) {
      return interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild);
    }
  }

  return false;
}
