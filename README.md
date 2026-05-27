# Discord News Bot

A Discord news-gathering bot that polls curated RSS feeds, normalizes articles, deduplicates and scores them by topic, and posts eligible stories as Discord embeds into topic-specific channels.

The project is built around a small, extensible event pipeline:

```txt
raw source -> normalized event -> dedupe -> scoring/filtering -> Discord publishing -> storage/logging
```

## Status

Phase 1 MVP is complete. Phase 2 curation and operations features are partially implemented, including favorites, email forwarding, bot manager controls, topic/source/keyword management, curation audit logs, and manual article removal.

## Technical Stack

- Runtime: Node.js `>=22 <23`
- Language: TypeScript
- Discord API: `discord.js` v14
- RSS parser: `rss-parser`
- Database: SQLite
- ORM: Prisma
- Scheduler: `node-cron`
- Mail forwarding: `nodemailer`
- Development runner: `tsx`

## Setup

Install dependencies:

```powershell
npm install
```

Create a `.env` file from `.env.example`:

```powershell
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Discord bot token. |
| `DISCORD_CLIENT_ID` | Discord application client ID. |
| `DISCORD_GUILD_ID` | Guild where commands are registered. |
| `DATABASE_URL` | SQLite database URI, for example `"file:./dev.db"`. |
| `POLL_CRON` | Cron schedule for polling, for example `*/30 * * * *`. |

Common optional variables:

| Variable | Description |
|---|---|
| `NODE_ENV` | Use `development` or `production`. |
| `RUN_IMMEDIATE` | In development, set `true` to poll once at startup. |
| `DRY_RUN` | Set `true` to log would-be posts without sending Discord messages. |
| `BOT_MANAGER_USER_IDS` | Comma-separated Discord user IDs allowed to run manager commands. |
| `BOT_MANAGER_ROLE_IDS` | Comma-separated Discord role IDs allowed to run manager commands. |
| `INSTAPAPER_USERNAME` / `INSTAPAPER_PASSWORD` | Optional Instapaper Simple API credentials for favorite sync. |
| `FORWARD_DESTINATION_EMAIL` | Destination email address for reaction-based email forwarding. |
| `FORWARD_EMAIL_EMOJI` | Optional custom emoji name for email forwarding reactions. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional SMTP settings for email forwarding. |
| `ALLOW_ETHEREAL_FALLBACK` | Allows Ethereal test mail fallback outside development when set to `true`. |
| `RSSHUB_BASE_URL` | Base URL of local or public RSSHub instance to use as fallback for failing YouTube feeds (e.g. `http://127.0.0.1:1200`). |
| `THREAD_INACTIVE_LIMIT_HOURS` | Thread archival inactivity limit in hours (default: `4`). |


Initialize Prisma and SQLite:

```powershell
npx prisma generate
npx prisma migrate dev --name init
```

Run the bot in development:

```powershell
npm run dev
```

Build and run production JavaScript:

```powershell
npm run build
npm start
```

## Configuration

Runtime configuration lives in `src/config/topics.json` and `src/config/sources.json`. Use `/reload-config` after manual file edits, or use the manager commands to persist changes from Discord.

### Topics

Each topic defines where articles post and how they are scored.

```json
{
  "toronto-eats": {
    "channelId": "1507578466982170686",
    "keywords": ["restaurant", "brunch", "opening"],
    "locationKeywords": ["scarborough", "ossington", "kensington market"],
    "blockedTerms": ["shooting", "police", "election"],
    "postThreshold": 30,
    "emoji": "<:torontofoodie3:1508674647711940702>",
    "disabled": false
  }
}
```

Fields:

- `channelId`: Discord channel ID for posted articles.
- `keywords`: Core topic terms. Title matches add 20 points; summary matches add 10 points.
- `locationKeywords`: Optional geographic terms. These only score when the article also matches a core keyword or comes from a trusted source.
- `blockedTerms`: Negative terms. Any match applies a 100 point penalty.
- `postThreshold`: Minimum score required to post.
- `emoji`: Optional Unicode or Discord custom emoji prefix for embed titles.
- `disabled`: Optional flag. Disabled topics are skipped by polling.

### Why Location Keywords Are Separate

Location terms are useful but noisy. A Toronto food topic may care about `scarborough` when an article is about a restaurant, but not when an article is about crime, sports, traffic, or politics in Scarborough.

The scorer handles this by separating:

- Core keywords: the article is about the topic.
- Location keywords: the article is relevant to a place.
- Blocked terms: the article should be suppressed or heavily penalized.

Location keyword points are only awarded if the article already has core topic context. A location-only match is recorded as ignored and receives no location score.

### Sources

RSS sources are grouped by topic.

```json
{
  "toronto-eats": [
    {
      "name": "Daily Hive Toronto",
      "url": "https://dailyhive.com/feed/toronto",
      "trusted": false
    }
  ]
}
```

Trusted sources receive a 15 point score bonus and can allow location keywords to score even when no core keyword matched.

### YouTube Ingestion & RSSHub Integration

YouTube's native XML feeds (e.g., `https://www.youtube.com/feeds/videos.xml?channel_id=...`) are frequently rate-limited or return error pages when requested directly by browsers or simple HTTP clients. To ensure high availability of video sources, the bot features a seamless local RSSHub integration:

1. **Fallback Logic**: If the bot's direct attempt to poll a YouTube channel feed fails, it automatically redirects the fetch query to a local **RSSHub** instance via `RSSHUB_BASE_URL`.
2. **Shorts Handling**: For YouTube channels that do not have a dedicated "Videos" tab (e.g., channels focusing strictly on Shorts or new channel layouts), the custom RSSHub route handler falls back to retrieving the channel's "Shorts" shelf and automatically maps those short-form uploads to the standard RSS structure.

## Discord Commands

The bot registers slash commands and one message context menu command at startup when `DISCORD_GUILD_ID` is configured.

### Autocomplete

Discord autocomplete runs while the user is focused in an autocomplete-enabled option. It returns at most 25 choices.

Topic autocomplete is sourced from configured topic names in `topics.json` and is enabled for:

- `/testfeed topic`
- `/lastposts topic`
- `/refresh topic`
- `/search topic`
- `/sources topic`
- `/favorites topic`
- `/audit topic`
- `/topic view topic`
- `/topic set-channel topic`
- `/topic set-threshold topic`
- `/topic set-emoji topic`
- `/topic disable topic`
- `/source list topic`
- `/source add topic`
- `/source remove topic`
- `/keyword view topic`
- `/keyword add topic`
- `/keyword remove topic`

Article autocomplete is enabled for `/unfavorite article`. It searches the invoking user's favorites using the current typed text and returns favorite IDs as option values.

Keyword autocomplete is enabled for `/keyword remove keyword`. It depends on the currently selected `topic` and `type`.

For `/keyword remove`, autocomplete depends on both `topic` and `type`:

- `type:standard` suggests `keywords`.
- `type:location` suggests `locationKeywords`.
- `type:negative` suggests `blockedTerms`.

If the required context is missing, such as an unknown `topic`, autocomplete returns no choices.

### Command Reference

| Command | Options | Access | Autocomplete | Description |
|---|---|---|---|---|
| `/ping` | none | Anyone | none | Check that the bot is responding. |
| `/testfeed` | `topic` required | Bot manager | `topic` | Dry-run a topic feed check without posting. |
| `/lastposts` | `topic` required, `status` optional, `hours` optional | Anyone | `topic` | Show recent posted or unposted articles. |
| `/reload-config` | none | Bot manager | none | Reload JSON config without restarting. |
| `/refresh` | `topic` optional, `hours` optional | Bot manager | `topic` | Run polling now; with `topic` and `hours`, re-score recent unposted articles for that topic. |
| `/stats` | none | Anyone | none | Show database totals, posted counts, skipped counts, and manual removal counts. |
| `/search` | `query` required, `topic` optional | Anyone | `topic` | Search stored article titles. |
| `/topics` | none | Anyone | none | List configured topics, thresholds, status, keywords, location keywords, and blocked terms. |
| `/sources` | `topic` optional | Anyone | `topic` | List configured RSS sources. |
| `/favorites` | `topic`, `query`, `source`, `since`, `limit` optional | Anyone | `topic` | Recall your saved favorites. |
| `/unfavorite` | `article` required | Anyone | `article` | Remove one of your saved favorites. |
| `/audit` | `topic` required, `limit`, `query`, `status` optional | Bot manager | `topic` | View recent curation and scoring logs. |
| `/topic` | subcommands below | Bot manager | `topic` where present | Manage topic lanes. |
| `/source` | subcommands below | Bot manager | `topic` where present | Manage RSS sources. |
| `/keyword` | subcommands below | Mixed | `topic`; `keyword` on remove | View and manage topic keywords. |

Message context menu command:

| Command | Target | Access | Description |
|---|---|---|---|
| `Remove Article` | A Discord message | Bot manager | Opens a modal to remove a bot-posted article with an operator reason. |
| `Merge to Thread` | A Discord message | Bot manager | Merges an isolated article into an existing active topic thread. |
| `Remove from Thread` | A Discord message | Bot manager | Removes an article from a thread, posting it as an isolated message. |

`/lastposts status` choices:

- `posted`: show posted articles.
- `unposted`: show indexed/skipped/deferred/removed articles.

`/audit status` choices:

- `POSTED`
- `SKIPPED_THRESHOLD`
- `SKIPPED_BLOCKED`
- `DEFERRED_COOLDOWN`
- `REMOVED`

### Topic Subcommands

| Subcommand | Options | Autocomplete | Description |
|---|---|---|---|
| `/topic list` | none | none | List all topics, including disabled topics. |
| `/topic view` | `topic` required | `topic` | Show full topic settings. |
| `/topic create` | `name` required, `channel` required, `threshold` optional, `emoji` optional | none | Create a topic lane. |
| `/topic set-channel` | `topic` required, `channel` required | `topic` | Change posting channel. |
| `/topic set-threshold` | `topic` required, `threshold` required | `topic` | Change posting threshold. |
| `/topic set-emoji` | `topic` required, `emoji` required | `topic` | Set an emoji prefix, or pass `clear` to remove it. |
| `/topic disable` | `topic` required | `topic` | Toggle active/disabled state. |

### Source Subcommands

| Subcommand | Options | Autocomplete | Description |
|---|---|---|---|
| `/source list` | `topic` required | `topic` | List sources for a topic. |
| `/source add` | `topic`, `name`, `url`, `trusted` required | `topic` | Add an RSS source. |
| `/source remove` | `topic`, `name` required | `topic` | Remove a source by name. |

### Keyword Subcommands

| Subcommand | Options | Access | Autocomplete | Description |
|---|---|---|---|---|
| `/keyword view` | `topic` required | Anyone | `topic` | View standard, location, and negative keywords. |
| `/keyword add` | `topic`, `keyword` required; `type` optional | Bot manager | `topic` | Add one or multiple comma-separated standard, location, or negative keywords. |
| `/keyword remove` | `topic`, `keyword` required; `type` optional | Bot manager | `topic`, `keyword` | Remove one or multiple comma-separated standard, location, or negative keywords. |

`/keyword type` choices:

- `standard`: edits `keywords`.
- `location`: edits `locationKeywords`.
- `negative`: edits `blockedTerms`.

### Favorites

- React to a bot-posted article with a heart emoji to save it as a personal favorite.
- Remove the heart reaction to delete that favorite.
- `/favorites [topic] [query] [source] [since] [limit]`: Recall your saved articles.
- `/unfavorite article:<favorite>`: Remove a favorite using autocomplete.

If Instapaper credentials are configured, favorited article URLs are also sent to Instapaper. The favorite record stores whether Instapaper sync succeeded, failed, or was skipped.

### Email Forwarding

React to a bot-posted article with a mail emoji, or the configured `FORWARD_EMAIL_EMOJI`, to forward the article by email.

The forwarding flow:

- Looks up the article by Discord message ID.
- Sends article title, source, topic, article URL, and Discord message link.
- Records an idempotent `EmailForward` row so successful forwards are not repeated.
- Sends the reacting user a DM with success, failure, or an Ethereal preview URL in development.

Configure `FORWARD_DESTINATION_EMAIL` and SMTP settings for production forwarding. In development, the bot can use Ethereal test mail when no SMTP host is configured.

### Curation Audit

- `/audit topic:<topic> [limit] [query] [status]`: View recent curation and scoring logs.

Supported status filters:

- `POSTED`
- `SKIPPED_THRESHOLD`
- `SKIPPED_BLOCKED`
- `DEFERRED_COOLDOWN`
- `REMOVED`

For removed articles, `/audit` shows the operator reason, original score, matched keywords, matched location keywords, and an aggregated culprit keyword summary for the last 100 removals.

### Bot Manager Access

Bot manager access is controlled by `BOT_MANAGER_USER_IDS`, `BOT_MANAGER_ROLE_IDS`, or Discord `Manage Guild` permission when no explicit manager IDs or roles are configured.

Manager-only commands include `/testfeed`, `/reload-config`, `/refresh`, `/audit`, `/topic`, `/source`, `/keyword add`, `/keyword remove`, and the `Remove Article` message context command. `/keyword view` is intentionally available to anyone so operators can inspect topic rules without edit permission.

### Manual Article Removal

Bot managers can right-click or long-press a bot-posted article and choose the message context menu command **Remove Article**.

The removal flow:

1. Authenticates the operator as a bot manager.
2. Verifies the Discord message maps to a stored article.
3. Shows a modal requiring a removal reason.
4. Deletes the Discord message.
5. Only after successful deletion, updates the article to `REMOVED` and stores the reason in `statusReason`.
6. Writes a `REMOVED` curation log with the reason and original scoring breakdown.

If Discord deletion fails, the database status and audit log are left unchanged and the operator receives an error.

## Scoring Summary

Article scores are deterministic:

- Title core keyword match: `+20`
- Summary core keyword match: `+10`
- Title location keyword match: `+20`, only with core topic context
- Summary location keyword match: `+10`, only with core topic context
- Trusted source bonus: `+15`
- Blocked term match: `-100`
- Missing URL: `-10`

Articles post when their score meets or exceeds the topic `postThreshold`, after dedupe and age/filter checks.

## Manual Smoke Testing

1. Invite the bot with `bot` and `applications.commands` scopes.
2. Confirm it has channel permissions for `Send Messages`, `Embed Links`, `Read Message History`, `Add Reactions`, and message deletion where manual removal is expected.
3. Start the bot with `npm run dev`.
4. Verify startup logs show config load, Discord connection, command registration, and scheduler startup.
5. Run `/ping`.
6. Run `/testfeed topic:<topic>`.
7. Run `/refresh topic:<topic>`.
8. Confirm a posted article appears in the configured channel.
9. React with a heart, then verify `/favorites`.
10. If email forwarding is configured, react with a mail emoji and confirm the DM/email result.
11. As a bot manager, use **Remove Article** on a bot post, submit a reason, and confirm the message disappears.
12. Run `/audit topic:<topic> status:REMOVED` and `/stats` to confirm removal diagnostics.

## Automated Verification

Run TypeScript typecheck:

```powershell
npm run typecheck
```

Run the full test suite:

```powershell
npm test
```

Run targeted test suites:

```powershell
npm run test:storage
npm run test:bot
```
