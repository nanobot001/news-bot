# Block 03: SQLite Dedupe Storage

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
