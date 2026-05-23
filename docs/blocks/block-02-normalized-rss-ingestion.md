# Block 02: Normalized RSS Ingestion

> Status: Implemented on 2026-05-23.
> Result: Implemented.
> Verification: `npm run typecheck` - passed; `npm run ingest:test` - passed.
> Notes: RSS XML parsing + optional-field-safe normalization to `NormalizedEvent`, with a fixture-backed ingestion script for deterministic verification.

## Goal

Fetch configured RSS feeds and convert feed items into shared `NormalizedEvent` objects.

## Scope

- Implement RSS fetching and parsing.
- Implement source registry access from `src/config/sources.json`.
- Normalize RSS items into `type: "news.article"` events.
- Keep raw feed item data available on `raw`.

## Out Of Scope

- SQLite persistence
- Dedupe
- Scoring
- Discord posting

## Acceptance Criteria

- A topic can be fetched from configured sources.
- RSS items become `NormalizedEvent` values.
- Missing optional fields are handled without crashing.

## Verification

Run typecheck and a small local ingestion test or script added by the block.
