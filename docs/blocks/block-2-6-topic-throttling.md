# Block 2-6: Topic-Specific Throttling & Cooldowns

## Goal

Prevent channel flooding and message spamming by implementing pacing limits, cooldown checks, and a database-backed queue for deferred articles.

## Scope

- **Topic Pacing Configuration:**
  - Add pacing controls in topic configuration:
    - `maxPostsPerHour`: Maximum articles that can be posted to the channel in a rolling 1-hour window.
    - `minMinutesBetweenPosts`: Minimum duration to wait before posting another article to the channel.
- **Database Deferred Queue:**
  - Update `CurationLog` or create a `DeferredQueue` table to store eligible articles that are blocked by pacing rules, marking them as `PENDING_QUEUE`.
- **Scheduler Throttling Evaluation:**
  - When the scheduler polls, it checks active topic pacing limits and any posted articles in the SQLite DB within the cooldown window.
  - If a post limit is exceeded, eligible new articles are saved to the database as `PENDING_QUEUE`.
  - On subsequent polling cycles, if the cooldown window has cleared, the scheduler retrieves the oldest `PENDING_QUEUE` article, publishes it, and updates its status to `POSTED`.

## Out Of Scope

- Slash commands to manually inspect/re-order/clear the pending queue.
- Cross-topic queue migrations.

## Acceptance Criteria

- Topics configured with `minMinutesBetweenPosts: 15` will never publish more than one article per 15 minutes, even if a poll finds multiple eligible articles.
- Excess eligible articles are successfully deferred to the database.
- Deferred articles are posted sequentially in chronological order on subsequent scheduler ticks as pacing limits allow.
- Automated tests verify rolling-hour calculations and queue retrieval/posting logic.

## Verification

- Run typecheck and unit tests.
- Trigger ingest for a feed with 10 high-scoring articles on a throttled topic, then verify only 1 is posted initially and subsequent items are posted on subsequent cycles.

## Status

Pending.
