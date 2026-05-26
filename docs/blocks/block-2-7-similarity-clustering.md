# Block 2-7: Similarity Clustering & On-Demand Threading

## Goal

Prevent duplicate embed alerts for different feeds covering the same story by grouping related coverage and updates inside a dedicated Discord thread spawned from the original post (the anchor). Provide manual curation controls for Bot Managers to correct any clustering mistakes (false positives/negatives).

## Scope

- **Alphanumeric Token Jaccard Similarity:**
  - Implement a tokenization and Jaccard similarity checker in `src/processing/similarity.ts` that ignores stop-words.
  - Compare incoming eligible articles against active anchors posted in the last 24 hours for the same topic.
  - A threshold (e.g. `similarityThreshold` in topic configuration, defaulting to `0.4`) determines if it's the same story.
- **On-Demand Thread Creation:**
  - Post the first article of a story cluster (the anchor) as a standalone embed in the main channel.
  - When a second similar article is detected:
    - Automatically create a Discord thread on the original anchor's message: `message.startThread({ name: cleanThreadTitle(anchor.title) })`. Truncate titles to 100 characters.
    - Post the second article's embed inside the thread.
    - Save the `threadId` to the anchor's SQLite record.
  - Any subsequent matching articles post directly inside the thread.
- **Thread Lifecycle Cleanup (24h-48h Inactivity):**
  - Run a cleanup check during scheduled polling ticks.
  - Identify active story anchors that haven't received updates in >= 24 hours.
  - Set the thread to `archived: true` and `locked: true` (if permissions allow).
  - Mark the anchor's status as `CLOSED` in SQLite.
- **Curation Commands (Message Context Menus):**
  - **"Merge to Thread"**: Allowed for Bot Managers. Select a standalone post, input a target anchor message ID/link, delete the post from the main channel, repost it inside the target thread, and link the DB records.
  - **"Split from Thread"**: Allowed inside threads. Select a message, delete it from the thread, repost it as a new standalone post in the main channel, and unlink/promote it in SQLite.
- **Required Discord Bot Permissions:**
  - Document the necessary channel permissions in the README: `Create Public Threads`, `Send Messages in Threads`, `Manage Threads`, and `Manage Messages`.

## Out Of Scope

- Semantic vector embeddings or LLM-based clustering.
- Dynamic clustering across multiple topics.
- Thread management command UI (beyond context menus).

## Acceptance Criteria

- Two feeds posting the same story are recognized as similar on arrival.
- The second story retroactively creates a thread on the first message and posts inside it.
- A third story posts directly to the existing thread.
- Threads inactive for >24 hours are archived and locked, and the story anchor is marked closed.
- Bot Managers can use "Merge to Thread" and "Split from Thread" commands to manually organize posts.
- Automated tests verify tokenization, similarity matching, thread creation, message reposting, and database updates.

## Verification

- Run typecheck and unit tests.
- Trigger ingesting overlapping stories and verify thread creation and message redirection in Discord.
- Trigger "Merge to Thread" and "Split from Thread" actions and verify UI and database adjustments.

## Status

> Status: Implemented on 2026-05-26.
> Result: Implemented.
> Verification: `npm test` - passed (all 149 tests).
> Notes: Successfully implemented alphanumeric token Jaccard similarity, lazy public thread creation, automated 24-hour inactivity thread cleanup, and Merge/Split context menu curation commands.
