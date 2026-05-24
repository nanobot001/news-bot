# Block 2-1: Heart Reaction Favorites & Instapaper Save

## Goal

Let each Discord user mark valuable posted articles with a heart reaction, persist those personal favorites locally, recall them with useful filters, and optionally save favorited article URLs to the operator's Instapaper account using the Instapaper Simple API.

## Scope

- **Heart Reaction Listener:**
  - Listen for heart reactions added to bot-posted article messages.
  - Ignore reactions on messages that are not mapped to stored posted articles.
  - Ignore bot/self reactions.
- **Personal Favorite Persistence:**
  - Add SQLite/Prisma storage for user-specific favorited posted articles, including:
    - Posted article ID or URL.
    - Topic key.
    - Discord channel ID and message ID.
    - Favoriting Discord user ID.
    - Created timestamp.
    - Optional Instapaper sync status.
  - Treat repeated hearts from the same user on the same article as idempotent.
- **Favorite Recall Command:**
  - Add `/favorites` as a personal recall command for the invoking user.
  - Support useful narrowing parameters:
    - `topic` optional topic filter.
    - `query` optional title/source/URL text search.
    - `source` optional source-name filter.
    - `since` optional time window such as `7d`, `30d`, or `2026-05-01`.
    - `limit` optional result count with a safe maximum.
  - Return matching personal favorites with title, source, topic, URL, and saved timestamp.
  - Sort recall results by newest favorite first.
- **Instapaper Simple API Sync:**
  - Add optional environment/config support for Instapaper credentials.
  - When an article is favorited, send the article URL to Instapaper via the Simple API if credentials are configured.
  - Store whether the Instapaper save succeeded, failed, or was skipped because credentials were not configured.
  - Log Instapaper failures without blocking local favorite persistence.

## Out Of Scope

- Full Instapaper OAuth/bookmark management API.
- Per-user Instapaper accounts.
- Semantic search across favorites.
- AI summaries of favorite lists.
- Automatically unfavoriting an article when a heart reaction is removed.
- Server-wide favorite browsing, except where favorite counts are already stored for future use.

## Acceptance Criteria

- Adding a heart reaction to a bot-posted article creates a local favorite record for that Discord user.
- Heart reactions on unrelated messages are ignored.
- Multiple users can heart the same article, but each user's recall results only include their own favorites.
- Repeated hearts from the same user do not create duplicate user favorite records.
- `/favorites` returns recent personal favorites for the invoking user.
- `/favorites topic:<topic>` narrows results to the user's favorites for that topic only.
- `/favorites query:<text>` narrows results by matching title, source, or URL text.
- `/favorites source:<source>` narrows results by source name.
- `/favorites since:<window>` narrows results to favorites saved in the requested time window.
- When Instapaper credentials are configured, favorited article URLs are submitted to Instapaper.
- Instapaper API failures are logged and do not prevent local favorites from being saved.
- Automated tests cover reaction filtering, favorite idempotency, personal recall filtering, recall ordering, and Instapaper success/failure handling.

## Verification

- Run typecheck and automated tests.
- In a development Discord server, post a test article and react with a heart.
- Verify the favorite appears in SQLite and `/favorites`.
- Verify `/favorites topic:<topic>`, `/favorites query:<text>`, and `/favorites since:7d` narrow results correctly.
- Configure Instapaper credentials and verify the URL appears in the target Instapaper account.
- Temporarily use invalid Instapaper credentials and verify local favorite persistence still succeeds.

## Status

Pending.
