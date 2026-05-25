# Block 2-4: Topic Keyword Inspection, Management & Refresh

## Goal

Make topic keyword tuning possible from Discord so the operator can inspect, add, and remove topic keywords while the bot is live, then re-score recent articles after retuning a topic.

## Scope

- **Unified Keyword Command:**
  - Add a single `/keyword` slash command with subcommands:
    - `/keyword view <topic>`
    - `/keyword add <topic> <keyword>`
    - `/keyword remove <topic> <keyword>`
  - Use topic autocomplete or validated topic choices when practical.
- **Keyword Inspection:**
  - `/keyword view <topic>` shows the complete keyword list for a single topic.
  - Split long keyword lists across multiple ephemeral responses or compact embeds so Discord message limits are respected.
- **Admin-Only Keyword Updates:**
  - Restrict `/keyword add` and `/keyword remove` to admins.
  - Allow `/keyword view` for normal users unless later operator feedback requires locking it down.
  - Reuse the authorization helper from Block 2-3.
  - Normalize keyword casing and whitespace consistently.
  - Reject duplicates and unknown topics with clear ephemeral messages.
- **Durable Persistence:**
  - Persist keyword changes to `src/config/topics.json`.
  - Reload the in-memory app config after a successful write so changes take effect without restarting the bot.
  - Write updates safely with a read-modify-write flow that preserves valid JSON and avoids partial writes.
- **Refresh After Keyword Retuning:**
  - Extend the existing `/refresh` command with an optional `hours` parameter.
  - Preserve current `/refresh` behavior when `hours` is omitted: fetch feeds now and process eligible new items normally.
  - When `hours` is provided:
    - Require `topic`.
    - Use the current in-memory config after any keyword update/reload.
    - Re-score recently ingested articles for that topic within the requested time window.
    - Include already-posted articles in the summary and clearly label them as already posted.
    - Never repost already-posted articles.
    - Only attempt to post articles that were previously skipped/unposted and now meet the topic threshold.
    - Cap the lookback window to a safe maximum such as 72 hours.
  - Return a concise summary including checked, already posted, still skipped, newly eligible, and posted-now counts.
- **Operational Logging:**
  - Log keyword additions/removals with topic, keyword, Discord user ID, and timestamp.

## Out Of Scope

- Editing source feed URLs.
- Editing blocked terms.
- Bulk keyword imports.
- Web dashboard.
- Multi-user approval workflows for config changes.
- Reposting already-posted articles during refresh rescans.

## Acceptance Criteria

- `/keyword view <topic>` shows the full keyword list for the requested topic.
- Non-admin users cannot run `/keyword add` or `/keyword remove`.
- Admin users can add a new keyword with `/keyword add <topic> <keyword>` and it immediately affects future scoring.
- Admin users can remove an existing keyword with `/keyword remove <topic> <keyword>` and it immediately stops affecting future scoring.
- Duplicate additions and missing removals return clear messages without corrupting config.
- Changes survive bot restarts because `topics.json` is updated.
- `/refresh topic:<topic> hours:<n>` re-scores recent ingested articles for that topic using the current keyword config.
- `/refresh topic:<topic> hours:<n>` reports already-posted articles separately and does not repost them.
- Previously skipped/unposted articles that now meet threshold are posted and recorded with updated status.
- Omitting `hours` from `/refresh` keeps the existing live polling behavior unchanged.
- Automated tests cover keyword normalization, duplicate handling, missing keyword removal, config persistence, command authorization, refresh rescore filtering, already-posted reporting, and unchanged live refresh behavior.

## Verification

- Run typecheck and automated tests.
- In a development Discord server, inspect keywords for one topic.
- Add a test keyword, run `/keyword view <topic>`, and verify it appears.
- Run `/testfeed <topic>` against an article containing the new keyword and verify the scoring reflects it.
- Run `/refresh topic:<topic> hours:24` and verify recent skipped/unposted items are re-scored with the new keyword.
- Verify already-posted articles are listed as already posted and are not posted again.
- Remove the test keyword and verify it no longer appears after reload/restart.

## Status

Pending.
