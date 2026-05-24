# Block 2-4: Similarity Clustering & Related Coverage Links

## Goal

Prevent duplicate embed alerts for different feeds covering the exact same story by grouping similar articles and appending related coverage links to existing embeds.

## Scope

- **Alphanumeric Token Jaccard Similarity:**
  - Implement a tokenization and Jaccard similarity checker in `src/processing/similarity.ts`.
  - Compare incoming eligible articles against articles posted in the last 12 hours for the same topic.
- **Embed Updates and Appending:**
  - If a new article matches an already-posted article above a configured similarity threshold (e.g. `similarityThreshold: 0.6`):
    - Retrieve the Discord message ID and channel ID of the original post from the database.
    - Instead of posting a new embed, fetch the message from Discord, and edit it to append the new source's title and link in a **"Related Coverage"** field or description update.
    - If editing fails or the message cannot be found, fallback to posting the new embed.
- **Database Mapping:**
  - Link the new article's DB record to the original posted article's record (e.g., parent-child relationship) to keep track of clustering.

## Out Of Scope

- Semantic vector embeddings (non-goal for Phase 2).
- Dynamic clustering across multiple different topics (isolation remains).

## Acceptance Criteria

- Two feeds posting the same story with slightly different titles (e.g. *"Apple announces M5 chip at event"* and *"Apple M5 chip unveiled at keynote"*) are recognized as similar.
- The second story does not trigger a new notification; it updates the existing Discord embed with a bullet point link to the second source.
- Automated tests verify tokenization, Jaccard distance calculation, and Mock Discord message editing.

## Verification

- Run typecheck and unit tests.
- Trigger ingest of two overlapping stories and visually verify that the second story adds a "Related Coverage" line to the original embed instead of creating a new message.

## Status

Pending.
