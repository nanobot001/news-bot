# Block 2-8: Similarity Clustering, Related Coverage & Updates

## Goal

Prevent duplicate embed alerts for different feeds covering the same story while still surfacing major developments. Near-duplicate coverage should be added to the original post as related coverage; meaningful updates should appear as replies to the original story anchor.

## Scope

- **Alphanumeric Token Jaccard Similarity:**
  - Implement a tokenization and Jaccard similarity checker in `src/processing/similarity.ts`.
  - Compare incoming eligible articles against articles posted in the last 12 hours for the same topic.
- **Story Anchor Model:**
  - Treat the first posted article in a story cluster as the anchor.
  - Link subsequent related articles to the anchor article in SQLite.
  - Keep topic isolation: only compare against recent anchors for the same topic.
- **Related Coverage Appending:**
  - If a new article is a near-duplicate or same-story coverage item above a configured similarity threshold:
    - Retrieve the Discord message ID and channel ID of the original post from the database.
    - Instead of posting a new embed, fetch the message from Discord, and edit it to append the new source's title and link in a **"Related Coverage"** field or description update.
    - If editing fails or the message cannot be found, fallback to posting the new embed.
  - Keep the related coverage list compact so the embed remains readable.
- **Major Update Replies:**
  - If a new article is related to an existing anchor but appears to represent a meaningful development, post it as a Discord reply to the anchor message instead of appending it quietly.
  - First-version major update detection can use deterministic rules such as title similarity plus update terms like `confirmed`, `official`, `breaking`, `injury`, `out`, `trade`, `wins`, `eliminated`, `final`, or `statement`.
  - Store reply message IDs and link them to the same story cluster.
- **Database Mapping:**
  - Link each related article's DB record to the anchor article's record.
  - Track whether the article was handled as `RELATED_COVERAGE`, `STORY_UPDATE_REPLY`, or `NEW_ANCHOR`.

## Out Of Scope

- Semantic vector embeddings (non-goal for Phase 2).
- Dynamic clustering across multiple different topics (isolation remains).
- LLM-based update classification (Phase 3 candidate).

## Acceptance Criteria

- Two feeds posting the same story with slightly different titles (e.g. *"Apple announces M5 chip at event"* and *"Apple M5 chip unveiled at keynote"*) are recognized as similar.
- The second story does not trigger a new notification; it updates the existing Discord embed with a bullet point link to the second source.
- A related article that matches major-update rules posts as a reply to the original anchor message.
- Related article records are linked to the anchor article in SQLite.
- Automated tests verify tokenization, Jaccard distance calculation, same-story append handling, major-update reply handling, and Mock Discord message editing/replying.

## Verification

- Run typecheck and unit tests.
- Trigger ingest of two overlapping stories and visually verify that the second story adds a "Related Coverage" line to the original embed instead of creating a new message.
- Trigger ingest of a related major update and visually verify it appears as a reply to the original anchor.

## Status

Pending.
