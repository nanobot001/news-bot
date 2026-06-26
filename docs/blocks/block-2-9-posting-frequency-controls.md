# Block 2-9: Noise Reduction, Frequency Controls, and Digest Pressure Valves

> Status: Planned.
> Result: Not implemented.
> Notes: Adds channel-noise controls after intent routing and digest lanes exist. Real-use feedback showed too much channel noise, not enough signal, too many low-value thread splits, and digest-heavy topics such as `toronto-eats` needing stronger consolidation.

## Goal

Keep immediate Discord posts high-signal by default. Limit bursts by topic, source, and content intent; route lower-urgency or excess items into digests; and reduce thread creation that only produces shallow one-update threads.

## Scope

- Add topic-level posting controls such as `cooldownMinutes`, `maxImmediatePerHour`, and `maxImmediatePerDay`.
- Add optional source-level and intent-level overrides for stricter controls on noisy sources or lower-urgency intents.
- Add topic policy for digest-first behavior, especially for topics with a high volume of useful but non-urgent posts such as `toronto-eats`.
- Route eligible-but-throttled items to digest, thread-only related coverage, or a deferred status depending on topic policy.
- Add thread quality controls so weakly related second articles can be digested instead of always creating a public thread.
- Prefer thread attachment when a strong existing story match exists, but avoid creating shallow threads for low-confidence matches.
- Record throttling decisions in curation logs with clear reasons.
- Update `/testfeed` or audit output to show whether a sample item would be throttled under current policy.
- Add recommended default policies for noisy content lanes such as discussion, aggregate, review, guide, and reaction.

## Out Of Scope

- AI ranking among throttled items.
- LLM-based story clustering or editorial review.
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
- Topics can declare digest-first intents so non-urgent items skip immediate posting unless they meet explicit high-signal criteria.
- `toronto-eats` has a digest-heavy policy that reduces main-channel noise while preserving collected links.
- Thread creation can require a stronger match or a minimum policy threshold, while strong matches still attach to existing threads.
- Low-confidence related items can be routed to digest instead of creating public one-update threads.
- Curation logs explain cooldown and cap decisions.
- Existing topics without frequency policies preserve current behavior.
- Automated tests cover topic caps, source caps, intent caps, digest-first routing, thread quality controls, fallback behavior, and audit/testfeed explanations.

## Verification

- `npm test`
- `npm run build`
- Simulate a burst of eligible items and verify only the configured number post immediately while the rest are routed according to policy.
- Simulate a high-volume `toronto-eats` burst and verify most lower-urgency items are digest-routed rather than posted immediately.
- Simulate weak related coverage and verify it does not create a shallow public thread unless the configured thread policy allows it.
