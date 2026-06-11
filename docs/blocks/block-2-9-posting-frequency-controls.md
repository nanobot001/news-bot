# Block 2-9: Posting Frequency Controls

> Status: Planned.
> Result: Not implemented.
> Notes: Adds channel-noise controls after intent routing and digest lanes exist.

## Goal

Limit bursts by topic, source, and content intent so immediate posts stay useful even when many sources produce relevant items at once.

## Scope

- Add topic-level posting controls such as `cooldownMinutes`, `maxImmediatePerHour`, and `maxImmediatePerDay`.
- Add optional source-level and intent-level overrides for stricter controls on noisy sources or lower-urgency intents.
- Route eligible-but-throttled items to digest, thread-only related coverage, or a deferred status depending on topic policy.
- Record throttling decisions in curation logs with clear reasons.
- Update `/testfeed` or audit output to show whether a sample item would be throttled under current policy.

## Out Of Scope

- AI ranking among throttled items.
- Per-user notification preferences.
- Sports schedule integration.
- External queue infrastructure.

## Likely Files Or Areas

- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `src/config/sources.json`
- `src/jobs/pollNews.ts`
- `src/storage/articleRepo.ts`
- `src/storage/articleStatus.ts`
- `src/bot/commands.ts`
- `tests/`

## Acceptance Criteria

- Topics can cap immediate posts per hour/day.
- Sources and intents can have stricter caps than the topic default.
- Throttled items are not lost; they are stored with an explicit route/status when policy allows digest or deferred handling.
- Curation logs explain cooldown and cap decisions.
- Existing topics without frequency policies preserve current behavior.
- Automated tests cover topic caps, source caps, intent caps, fallback behavior, and audit/testfeed explanations.

## Verification

- `npm test`
- `npm run build`
- Simulate a burst of eligible items and verify only the configured number post immediately while the rest are routed according to policy.
