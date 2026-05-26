# Block 2-4: Topic & Source Management Commands

> Status: Completed.
> Result: Implemented.
> Notes: Adds the Discord-side control plane for creating and adjusting topic lanes before keyword, trust, throttling, and digest settings expand.

## Goal

Make topic and RSS source management possible from Discord for explicitly authorized bot managers, while keeping configuration file-backed, deterministic, and reloadable without restarting the bot.

## Scope

- Add bot manager identity support using configured Discord user IDs and role IDs:
  - `BOT_MANAGER_USER_IDS`
  - `BOT_MANAGER_ROLE_IDS`
- Reuse or extend the authorization helper from Block 2-3 so configuration-changing commands have one permission model.
- Add a `/topic` command with subcommands for:
  - `/topic list`
  - `/topic view <topic>`
  - `/topic create <name> <channel> [threshold] [emoji]`
  - `/topic set-channel <topic> <channel>`
  - `/topic set-threshold <topic> <threshold>`
  - `/topic set-emoji <topic> <emoji>`
  - `/topic disable <topic>`
- Add a `/source` command with subcommands for:
  - `/source list <topic>`
  - `/source add <topic> <name> <url> <trusted>`
  - `/source remove <topic> <name>`
- Persist successful changes to `src/config/topics.json` and `src/config/sources.json`.
- Reload the in-memory app config after successful writes so later polls and commands use the new configuration.
- Validate topic names, channel inputs, thresholds, source URLs, duplicate source names, and unknown topics with clear ephemeral replies.
- Keep existing read-only inspection commands working for normal users unless Block 2-3 decides otherwise.

## Out Of Scope

- Hard-deleting topics and historical article data.
- Renaming topics and migrating existing article/favorite/audit rows.
- Keyword add/remove operations, which belong in Block 2-5.
- Editing blocked terms, advanced trust tiers, throttling, digest rules, or source scoring modifiers.
- Database-backed configuration storage.
- Multi-user approval workflows.

## Likely Files Or Areas

- `src/bot/commands.ts`
- `src/bot/authorization.ts`
- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `src/config/sources.json`
- `tests/`
- `README.md`
- `.env.example`

## Acceptance Criteria

- A Discord user whose ID is listed in `BOT_MANAGER_USER_IDS` can create, update, and disable topics from Discord.
- A Discord user with a role listed in `BOT_MANAGER_ROLE_IDS` can create, update, and disable topics from Discord.
- A non-manager user attempting a mutating `/topic` or `/source` command receives an ephemeral permission denial.
- `/topic create` adds a valid topic to `topics.json`, initializes an empty source list in `sources.json`, reloads config, and makes the topic visible to later commands.
- `/topic disable` stops future polling for the topic without deleting historical article, favorite, or audit data.
- `/source add` and `/source remove` update `sources.json`, reload config, and preserve valid JSON formatting.
- Invalid topic names, invalid thresholds, duplicate topics, duplicate source names, malformed URLs, and unknown topics are rejected without corrupting config files.
- Existing `/topics` and `/sources` read-only behavior continues to work.
- Automated tests cover bot manager authorization, topic config persistence, source config persistence, duplicate handling, invalid input handling, and in-memory reload behavior after writes.

## Verification

- `npm test`
- `npm run build`
- In a development Discord server, add your Discord user ID to `BOT_MANAGER_USER_IDS`, restart the bot, create a test topic, add a test source, inspect both from Discord, then disable the test topic.
- Verify `src/config/topics.json` and `src/config/sources.json` remain valid formatted JSON after each command.
