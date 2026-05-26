# Discord News Bot

A Discord news-gathering bot MVP that polls curated RSS feeds, normalizes articles into an internal event format, deduplicates and scores them, and posts eligible articles as rich embeds into topic-specific channels.

The project is structured as a robust event pipeline designed for extensibility:

```txt
raw source -> normalized event -> dedupe -> scoring/filtering -> Discord publishing -> storage/logging
```

---

## Status: Stable (Phase 1 MVP Complete)

The Phase 1 MVP is fully implemented, verified, and ready for deployment.

---

## Technical Stack

- **Runtime:** Node.js (v20+)
- **Language:** TypeScript
- **Discord API:** `discord.js` (v14)
- **RSS Parser:** `rss-parser`
- **Database:** SQLite (local file database)
- **ORM:** Prisma
- **Scheduler:** `node-cron`
- **Execution:** `tsx` (development), `tsc` (production build)

---

## Setup & Installation

### 1. Install Dependencies
Clone the repository, navigate to the root directory, and install npm dependencies:
```powershell
npm install
```

### 2. Configure Environment Variables (`.env`)
Create a `.env` file in the root directory. You can copy the template from `.env.example`:
```powershell
cp .env.example .env
```
Fill in the following environment variables:

| Environment Variable | Description |
|---|---|
| `DISCORD_TOKEN` | The secret token of your Discord bot. |
| `DISCORD_CLIENT_ID` | The Application Client ID of your Discord bot. |
| `DISCORD_GUILD_ID` | The Server (Guild) ID where you want to register slash commands for development. |
| `DATABASE_URL` | SQLite database URI, e.g., `"file:./dev.db"`. |
| `NODE_ENV` | Environment state (`development` or `production`). |
| `POLL_CRON` | Cron schedule expression for polling, e.g., `*/30 * * * *` (polls every 30 minutes). |
| `RUN_IMMEDIATE` | *(Optional, Dev only)* Set to `true` to trigger an immediate polling run upon startup. |
| `DRY_RUN` | *(Optional, Dev only)* Set to `true` to print embeds to console without posting to Discord. |
| `BOT_MANAGER_USER_IDS` | *(Optional)* Comma-separated list of Discord user IDs allowed to run management commands. |
| `BOT_MANAGER_ROLE_IDS` | *(Optional)* Comma-separated list of Discord role IDs allowed to run management commands. |

**Example `.env`:**
```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=123456789012345678
DISCORD_GUILD_ID=123456789012345678
DATABASE_URL="file:./dev.db"
NODE_ENV=development
POLL_CRON="*/30 * * * *"
RUN_IMMEDIATE=true
DRY_RUN=false
```

---

## Configuration Files

The bot's routing, scoring rules, and ingest sources are defined in two JSON configuration files located in `src/config/`.

### 1. Topics Routing & Rules (`src/config/topics.json`)
Defines target channels and scoring rules for each news topic.
- **`channelId`**: The Discord channel ID where eligible news will be posted.
- **`keywords`**: Terms that give a +20/10 score bonus per occurrence.
- **`blockedTerms`**: Terms that immediately penalize an article with -100 points.
- **`postThreshold`**: The minimum score required for an article to be posted (eligible).
- **`emoji`**: *(Optional)* Discord emoji (Unicode or custom) to prefix posted titles.
- **`disabled`**: *(Optional)* Boolean flag. If `true`, polling for this topic is skipped.

```json
{
  "anime": {
    "channelId": "1507578466982170686",
    "keywords": ["anime", "trailer", "season", "adaptation"],
    "blockedTerms": ["sponsored"],
    "postThreshold": 50,
    "emoji": "📺",
    "disabled": false
  },
  "movies": {
    "channelId": "1507578466982170686",
    "keywords": ["trailer", "box office", "release date", "streaming"],
    "blockedTerms": ["celebrity gossip"],
    "postThreshold": 50
  }
}
```

### 2. Ingest Sources (`src/config/sources.json`)
Defines the RSS feeds to poll, grouped under their respective topics.
- **`name`**: Descriptive label for the feed.
- **`url`**: The RSS XML feed URL.
- **`trusted`**: Boolean flag. If `true`, articles from this source receive a +50 bonus to their score.

```json
{
  "anime": [
    {
      "name": "Anime News Network",
      "url": "https://www.animenewsnetwork.com/all/rss.xml",
      "trusted": true
    }
  ],
  "movies": [
    {
      "name": "Example Movie Feed",
      "url": "https://example.com/rss",
      "trusted": false
    }
  ]
}
```

---

## Database Initialization (Prisma & SQLite)

The storage and deduplication system uses Prisma with SQLite. Run the following commands to initialize the database:

```powershell
# 1. Generate Prisma Client
npx prisma generate

# 2. Deploy Schema & Create Database
npx prisma migrate dev --name init
```

This creates the SQLite database file specified in your `DATABASE_URL` (typically `prisma/dev.db`) and creates the `Article` table used for deduplication.

---

## Running the Bot

### Development Mode
Runs the bot directly from TypeScript sources using `tsx`. If `RUN_IMMEDIATE=true` is set in `.env`, the first poll will start immediately.
```powershell
npm run dev
```

### Production Build & Execution
Build (compile) the TypeScript sources to JavaScript and start the production bot:
```powershell
# Compile TypeScript to dist/
npm run build

# Start the compiled bot
npm start
```

---

## Slash Commands

The bot automatically registers the following slash commands in the server matching your `DISCORD_GUILD_ID` upon startup:

- **`/ping`**: Replies with `pong!` to verify bot connectivity and slash command response latency.
- **`/testfeed <topic>`**: Performs a dry-run check of the feeds for a given topic. It prints statistics on feeds checked, items found, new items, and items passing the eligibility threshold, *without* posting anything to Discord or saving duplicates.
- **`/lastposts <topic>`**: Queries the SQLite database and returns a list of the 5 most recently posted and saved articles for the specified topic.
- **`/reload-config`**: Reloads the `topics.json` and `sources.json` configuration files in-place without restarting the bot. Any scheduled poll or command run after this will use the new configurations.
- **`/topic`**: Bot manager suite for topic management.
  - `/topic list`: Lists all topics and their settings, highlighting active vs. disabled status.
  - `/topic view <topic>`: Shows detailed channel, threshold, emoji, and RSS source configurations for a topic.
  - `/topic create <name> <channel> [threshold] [emoji]`: Creates a new topic configuration lane.
  - `/topic set-channel <topic> <channel>`: Sets the target posting channel for a topic.
  - `/topic set-threshold <topic> <threshold>`: Sets the posting score threshold for a topic.
  - `/topic set-emoji <topic> <emoji>`: Sets or clears (using `clear`) the emoji prefix for a topic.
  - `/topic disable <topic>`: Toggles the disabled/active state of a topic.
- **`/source`**: Bot manager suite for managing RSS feed sources per topic.
  - `/source list <topic>`: Lists all configured RSS sources for a topic.
  - `/source add <topic> <name> <url> <trusted>`: Adds a new RSS source to a topic (and marks it trusted/untrusted).
  - `/source remove <topic> <name>`: Removes an RSS source from a topic by its name.

---

## Verification & Manual Smoke Testing

Follow these steps to manually verify the bot setup on a development Discord server:

1. **Invite Bot to Guild:** Ensure your bot has been invited to your server with `bot` and `applications.commands` scopes.
2. **Channel Permissions:** Ensure the bot has `Send Messages` and `Embed Links` permissions in the channels configured in `topics.json`.
3. **Start the Bot:** Run `npm run dev`. Verify the logs output:
   - Successful loading of topics and sources.
   - Successful slash command registration to the guild.
   - Successful gateway connection ("Connected as ...").
4. **Trigger Commands in Discord:**
   - Run `/ping` in any channel. Verify response.
   - Run `/testfeed anime`. Verify the bot reports feed status, scoring, and eligible posts count.
   - Run `/reload-config`. Verify the bot confirms configuration has been reloaded.
5. **Verify Scheduled Polling Logs:** Verify structured logging outputs poll statistics (e.g., `Checked X feeds, found Y new articles, posted Z articles`).
6. **Verify Database Persistence:** Run `/lastposts anime` to verify that previously posted articles can be retrieved from the database.

---

## Automated Verification

You can run automated checks at any time using:

```powershell
# Run TypeScript Typecheck
npm run typecheck

# Run Test Suite
npm test
```
