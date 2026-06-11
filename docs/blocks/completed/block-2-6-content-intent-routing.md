# Block 2-6: Content Intent Classification & Routing

> Status: Implemented on 2026-06-10.
> Result: Implemented.
> Verification: `npm run build` - passed; `npm test` - passed, 196 tests.
> Notes: Added deterministic content intent classification, explicit routing decisions, durable article intent/route fields, `/testfeed` diagnostics, Reddit discussion defaults, and Google News search aggregate defaults.

## Goal

Classify each normalized article into a content intent and use that intent, source trust, and topic policy to decide whether it should post immediately, become thread-only related coverage, enter a digest queue, enter a review queue, or be skipped.

## Scope

- Add a deterministic content intent model with values such as `news`, `official`, `review`, `guide`, `opinion`, `discussion`, `reaction`, `aggregate`, and `mixed`.
- Extend source configuration with optional `intentDefault`, `tier`, and routing hints while preserving existing `trusted` behavior.
- Extend topic configuration with intent routing policies, including per-intent route, threshold override, and optional digest eligibility.
- Implement rule-based item classification that combines source defaults with title/summary clues.
- Treat Reddit and forum-like sources as `discussion` by default unless explicitly configured otherwise.
- Treat Google News search feeds and other broad search feeds as `aggregate` by default unless explicitly configured otherwise.
- Preserve immediate posting for high-confidence `news` and `official` items that pass scoring/filtering.
- Add curation/audit explanations showing the selected intent, confidence, route, and key classification reasons.
- Update `/testfeed` output so bot managers can see intent classification and routing before an item posts.

## Out Of Scope

- LLM-based classification.
- Sports schedule or event-phase detection.
- Digest publishing implementation beyond assigning digest-eligible statuses or routes.
- Dynamic Discord-side editing of intent policy.
- Adding X/Twitter or other non-RSS source adapters.

## Likely Files Or Areas

- `src/config/loadConfig.ts`
- `src/config/sources.json`
- `src/config/topics.json`
- `src/normalization/normalizedEvent.ts`
- `src/processing/scoreArticle.ts`
- `src/processing/filterArticle.ts`
- `src/jobs/pollNews.ts`
- `src/bot/commands.ts`
- `src/storage/articleStatus.ts`
- `prisma/schema.prisma`
- `tests/`

## Acceptance Criteria

- Sources may declare `intentDefault`, `tier`, and optional routing hints without breaking existing source configs.
- Topics may declare intent routing policies while existing topics without policies continue to work.
- Reddit sources classify as `discussion` by default and are not immediately posted unless a topic policy explicitly allows it.
- Mixed sources such as BlogTO-style feeds can classify individual items as `news`, `review`, `guide`, or `reaction` based on item-level rules.
- High-confidence `news` and `official` items remain eligible for immediate posting when they pass scoring/filtering.
- Digest/review/thread-only decisions are stored in article status or article metadata and explained in curation logs.
- `/testfeed` includes score, intent, confidence, selected route, and classification reasons.
- Automated tests cover source defaults, item-level overrides, Reddit discussion routing, aggregate feed routing, and backwards compatibility for existing configs.

## Verification

- `npm test`
- `npm run build`
- Run `/testfeed` against representative news, Reddit discussion, review/guide, opinion, reaction, and aggregate examples.
