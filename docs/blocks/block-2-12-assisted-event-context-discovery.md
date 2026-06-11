# Block 2-12: Assisted Event Context Discovery

> Status: Planned.
> Result: Not implemented.
> Notes: Adds a proposal-and-approval workflow for event contexts after sports team context proves the cached event-phase model.

## Goal

Let bot managers ask the bot to discover event contexts related to a topic, then review and approve the useful candidates before those contexts affect routing. The bot may suggest calendars or events, but it must not silently trust discovered events for posting behavior.

## Scope

- Add an event context model for approved events and recurring event sources, such as conferences, product launch events, gaming showcases, elections, or custom event windows.
- Add discovery workflows that can propose event contexts for a topic from:
  - a small built-in registry of high-confidence recurring events;
  - source-derived signals, such as repeated mentions of a named event in recent articles;
  - optional search-based discovery when enabled by configuration or an explicit manager command.
- Add manager-facing commands or command stubs for:
  - listing discovered candidates for a topic;
  - approving a candidate;
  - disabling or removing an approved context;
  - listing approved contexts.
- Store discovered candidates separately from approved contexts so unapproved discoveries never affect routing.
- Classify incoming items against approved event contexts using event timing, aliases, keywords, title/summary clues, and source metadata.
- Reuse the event-phase vocabulary from Block 2-11 where possible: `pre_event`, `live_event`, `result`, `post_event`, `reaction`, `analysis`, and `evergreen`.
- Add curation/audit explanations showing matched event context, phase, confidence, and reasons.

## Out Of Scope

- Fully autonomous event discovery that changes routing without manager approval.
- Large-scale web crawling.
- Paid event databases.
- LLM-only classification or routing decisions.
- Replacing the dedicated sports team registry from Block 2-11.

## Likely Files Or Areas

- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `src/services/`
- `src/processing/`
- `src/storage/articleRepo.ts`
- `prisma/schema.prisma`
- `src/bot/commands.ts`
- `tests/`

## Acceptance Criteria

- A manager can request event-context discovery for a topic and see candidate contexts without enabling them.
- Discovery candidates include source, confidence, reasons, proposed aliases/keywords, and suggested event timing when available.
- Only approved contexts affect article classification or routing.
- Approved contexts can classify items by event phase with confidence and reasons.
- The bot records event-context matches in curation logs and `/testfeed` output.
- Topics without approved contexts preserve existing behavior.
- Automated tests cover candidate discovery, approval, disabled/unapproved candidates, phase matching, audit explanations, and backwards compatibility.

## Verification

- `npm test`
- `npm run build`
- Run discovery against mocked AI/gaming/sports-adjacent article fixtures and verify candidates require explicit approval before routing changes.
