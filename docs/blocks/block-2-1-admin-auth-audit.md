# Block 2-1: Admin Authorization & Curation Audit Logs

## Goal

Secure admin-level bot commands and implement database-backed logs tracking all curation decisions, with an audit slash command to view them.

## Scope

- **Command Authorization Gates:**
  - Restrict administrative slash commands (`/reload-config`, `/testfeed`, and the new `/audit`) to users with Discord server administration rights (`Administrator` or `ManageGuild` permission) or a specific config-defined role (e.g., `ADMIN_ROLE_ID`).
- **Curation Audit Logging:**
  - Create a new SQLite table `CurationLog` via Prisma storing:
    - Article title, URL, source, and topic.
    - Evaluation status (`POSTED`, `SKIPPED_THRESHOLD`, `SKIPPED_BLOCKED`, `DEFERRED_COOLDOWN`).
    - Raw score and detailed scoring breakdown (e.g., matching keywords, priority boosts, penalties).
    - Creation timestamp.
  - Update the news polling job to write an entry to `CurationLog` for every evaluated article.
- **Audit Slash Command:**
  - Implement a `/audit <topic> [limit]` slash command.
  - Retrieve and display a cleanly formatted list of recent evaluation logs for the requested topic, indicating why articles were skipped or posted.

## Out Of Scope

- Complex multi-guild role hierarchies.
- Web dashboard or UI for curation logs.
- Automatic log pruning/expiration (handled in operational guides/scripts).

## Acceptance Criteria

- Non-admin users attempting to invoke `/reload-config`, `/testfeed`, or `/audit` receive an ephemeral error: *"You do not have permission to run this command."*
- Polling jobs populate the `CurationLog` table correctly.
- `/audit <topic>` returns a clear list of recently evaluated articles, their scores, and reasons for skip/post.
- New unit tests cover authorization check helpers and `CurationLog` database operations.

## Verification

- Run typecheck and automated tests.
- Exercise commands in a development Discord server as both an Administrator and a standard user.
- Verify `CurationLog` entries using Prisma Studio or sqlite CLI.

## Status

Pending.
