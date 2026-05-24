# Block 2-5: Topic Daily Digests

## Goal

Provide scheduled, consolidated digest updates for specific topics, collecting lower-priority articles and posting them once a day as a summary checklist/bullet list.

## Scope

- **Digest Configurations:**
  - Update topic configurations to support digest behavior:
    - `digestEnabled`: boolean.
    - `digestCron`: cron expression specifying when to send the digest.
    - `digestThreshold`: articles scoring above this but below `postThreshold` are marked for digest only.
- **Digest Storage Accumulator:**
  - Store articles that fall into the digest score range in SQLite, marked as `DIGEST_PENDING`.
- **Digest Publisher Job:**
  - Implement a scheduler task mapped to the configured `digestCron`.
  - When triggered, gather all `DIGEST_PENDING` articles for that topic.
  - Formulate a single structured Discord embed showing a summary list of all collected articles (title-links, source names, and scores).
  - Post the digest embed to the topic's configured channel and mark the articles as `POSTED_DIGEST` in the database.
  - Update `/testfeed` to allow force-previewing a digest.

## Out Of Scope

- Dynamic digest generation per user (channel-level only).
- AI summaries of the digest (Phase 3).

## Acceptance Criteria

- Scheduled digests execute at the correct times using the configured cron rules.
- Articles in the digest range do not trigger instant posts, but are successfully accumulated.
- A compiled digest embed displays all eligible articles in a clean, compact bulleted format.
- Automated tests verify digest range filtering, accumulation retrieval, and digest formatting.

## Verification

- Run typecheck and unit tests.
- Configure a topic for a digest run every minute (for testing), ingest mock articles, and verify the compiled digest is posted to Discord.

## Status

Pending.
