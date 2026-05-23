# Block 04: Scoring And Filtering

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
