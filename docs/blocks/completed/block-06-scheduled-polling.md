# Block 06: Scheduled Polling

> Status: Implemented on 2026-05-23.
> Result: Implemented.
> Verification: `npm run test:all` - passed. Also verified via local manual execution of `RUN_IMMEDIATE=true DRY_RUN=true npm run dev`.
> Notes: Implements `node-cron` scheduled news polling with structured, log-on-demand strategy and feed-level graceful error handling.

## Goal

Run the news polling pipeline on a schedule and log per-topic results.

## Scope

- Use `node-cron` with `POLL_CRON`.
- For each topic, process each configured source.
- Fetch, normalize, dedupe, score, filter, publish, and store results.
- Log checked, new, skipped, and posted counts per topic.

## Out Of Scope

- Daily digest
- Per-topic posting limits beyond threshold filtering
- Multi-process queueing

## Acceptance Criteria

- Polling runs on the configured interval.
- Each run reports useful counts.
- Failures in one feed do not stop all topics from processing.

## Verification

Run typecheck and a local poll against configured development feeds.
