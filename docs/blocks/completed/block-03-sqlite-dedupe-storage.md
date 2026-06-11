# Block 03: SQLite Dedupe Storage

> Status: Implemented on 2026-05-23.
> Result: Implemented.
> Verification: `npm run test:storage` - passed.
> Notes: Persistent SQLite storage implemented using Prisma with optimized single-query, topic-scoped deduplication checks on GUID, normalized URL, and normalized title.

## Goal

Persist article records in SQLite and prevent reposting duplicates.

## Scope

- Implement Prisma schema for article records.
- Add Prisma client wrapper.
- Add article repository functions.
- Check duplicates by RSS GUID, canonical URL hash, and title hash fallback.

## Out Of Scope

- Scoring
- Discord posting
- Scheduled polling

## Acceptance Criteria

- Article records persist to SQLite.
- Duplicate checks prevent repeated article insertion or repost marking.
- Raw JSON can be stored for audit/debugging.

## Verification

Run Prisma generation/migration commands and repository tests added by the block.
