# Block 04: Scoring And Filtering

> Status: Implemented on 2026-05-23.
> Result: Implemented.
> Verification: `npm run typecheck` and `node --import tsx --test tests/scoring.test.ts` - passed.
> Notes: Deterministic relevance scoring (word boundary plus plural suffix matching, binary keyword scoring, trusted source boosts, penalties for missing URLs or blocked terms) and eligibility filtering are fully implemented and verified via unit tests.

## Goal


Score normalized articles deterministically and decide whether they are eligible to post.

## Scope

- Implement keyword title scoring.
- Implement summary/content scoring.
- Implement trusted-source bonus.
- Implement blocked-term penalty.
- Implement missing-URL penalty.
- Compare score to topic post threshold.

## Out Of Scope

- LLM ranking or summaries
- Grouping related articles
- Daily digest behavior

## Acceptance Criteria

- Scores are predictable from topic config and source trust.
- Blocked terms lower scores.
- Articles below threshold are skipped.
- Article filtering returns useful debug reasons for logs and `/testfeed`.

## Verification

Run typecheck and scoring/filtering unit tests added by the block.
