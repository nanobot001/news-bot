# Block 2-3: Bot Manager Authorization & Curation Audit Logs

## Goal

Secure bot manager-level commands and implement database-backed logs tracking all curation decisions, with an audit slash command to view them.

## Scope

- **Command Authorization Gates:**
  - Restrict operational slash commands (`/reload-config`, `/testfeed`, and the new `/audit`) to configured bot managers.
  - Support Discord user and role allowlists such as `BOT_MANAGER_USER_IDS` and `BOT_MANAGER_ROLE_IDS`.
  - Optionally allow Discord `ManageGuild` as a fallback only when no explicit allowlist is configured.
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
- Passwords, shared secrets, or login flows inside slash commands.
- Web dashboard or UI for curation logs.
- Automatic log pruning/expiration (handled in operational guides/scripts).

## Acceptance Criteria

- Non-manager users attempting to invoke `/reload-config`, `/testfeed`, or `/audit` receive an ephemeral error: *"You do not have permission to run this command."*
- A user ID listed in `BOT_MANAGER_USER_IDS` can run protected commands.
- A member with a role listed in `BOT_MANAGER_ROLE_IDS` can run protected commands.
- Polling jobs populate the `CurationLog` table correctly.
- `/audit <topic>` returns a clear list of recently evaluated articles, their scores, and reasons for skip/post.
- New unit tests cover authorization check helpers and `CurationLog` database operations.

## Verification

- Run typecheck and automated tests.
- Exercise commands in a development Discord server as a configured bot manager and a standard user.
- Verify `CurationLog` entries using Prisma Studio or sqlite CLI.

## Status

> Status: Implemented on 2026-05-26.
> Result: Implemented.
> Verification: `npm run test` - passed.
> Notes: Secured /reload-config, /testfeed, and /audit slash commands, implemented SQLite-backed CurationLog schema and persistence, and added comprehensive unit tests covering auth gate helper and audit log command execution.
