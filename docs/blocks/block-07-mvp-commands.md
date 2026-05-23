# Block 07: MVP Commands

## Goal

Implement the remaining MVP slash commands.

## Scope

- `/testfeed <topic>` reports feeds checked, items found, new items, and posts eligible.
- `/lastposts <topic>` shows recently posted items.
- `/reload-config` reloads config files without restarting the bot.
- Keep `/ping` working.

## Out Of Scope

- Complex permissions
- Admin role management
- Reaction-based learning

## Acceptance Criteria

- Commands respond clearly in Discord.
- Unknown topics return useful errors.
- Reloading config affects later polling and command behavior.

## Verification

Run typecheck and manually exercise each command in a development Discord server.

## Status

Completed. All Acceptance Criteria met, and automated tests verify formatting, in-place reload, DB query helpers, and dry-run execution.

