# Block 2-9: Posting Frequency Controls and Digest Routing

> Status: Implemented on 2026-06-25.
> Result: Implemented with limitations.
> Verification: `npm run typecheck` - passed; `npm run build` - passed; `npm test` - not run successfully in this sandbox (`spawn EPERM`).
> Notes: Added a deterministic posting-control layer, Toronto Eats calibration, digest-first routing for throttled useful items, preview-only `/refresh hours`, and pruning protection for digest/review coverage records.

## Goal

Keep immediate Discord posts high-signal by default. Limit bursts by topic, source, and content intent, route lower-priority eligible items into digests, and preserve immediate slots for the strongest items.

This block is about signal quality, not just raw volume reduction. Caps must not simply let the first mediocre item win a live-post slot.

## Implementation Direction

- Add a pure `postingControls` evaluator after scoring, filtering, and content intent routing, before posting, story/thread handling, curation logging, and persistence.
- Keep the first pass focused on digest routing and posting caps.
- Use deterministic priority guidance when immediate slots are limited, based on existing signals such as score, trusted source, source tier, content intent, recency, and high-signal title cues.
- Do not add LLM or Gemini triage in this block.
- Do not implement deeper thread-quality changes in this block beyond allowing useful-but-lower-priority items to go to digest instead of live posting.

## Policy Precedence

Apply posting controls in this order:

1. Hard filter or skip decisions from scoring/filtering.
2. Digest-first topic or intent policy.
3. Source and intent caps, using the stricter applicable policy.
4. Topic caps and cooldown.
5. Immediate post fallback for items that remain eligible.

Source route hints may make an item stricter, such as moving it toward digest or review, but should not bypass a digest-first topic policy in this first pass.

## Scope

- Add topic-level posting controls such as `cooldownMinutes`, `maxImmediatePerHour`, and `maxImmediatePerDay`.
- Add optional source-level and intent-level overrides for stricter controls on noisy sources or lower-urgency intents.
- Add digest-first topic policy, especially for topics with a high volume of useful but non-urgent posts.
- Route eligible-but-throttled items to digest or deferred status depending on topic policy.
- Record throttling decisions in curation logs with clear reasons.
- Update `/testfeed` or audit output to show original route, final route, cap or cooldown reason, and whether the item would post, digest, review, or defer.
- Add recommended default policies for noisy content lanes such as `discussion`, `aggregate`, `review`, `guide`, `opinion`, and `reaction`.
- Route `/refresh hours` through the same posting-control decision path, or make refresh preview-only for capped topics so it cannot bypass Block 2-9 policy.

## Toronto Eats Calibration

Use `toronto-eats` as the first tuned example of digest-heavy behavior:

- Route lower-urgency `aggregate`, `discussion`, `review`, `guide`, `reaction`, and `opinion` items to digest by default.
- Preserve immediate escape hatches for high-signal items such as strong openings, closings, Michelin or award news, trusted local restaurant news, or other clearly timely local stories.
- Simulate noisy Toronto Eats bursts with Google aggregate items, Reddit discussion items, YouTube guide/review items, local listicles, and one high-signal opening or closing item.

## Storage And Status Conventions

- Throttled-but-useful items should become `DIGEST_PENDING` with `route = digest_pending`.
- Avoid a database migration unless delayed retry or true deferred posting becomes necessary.
- Count only immediate main-channel posts for caps, likely `status = POSTED`.
- Do not count `POSTED_DIGEST` items as immediate posts.
- Update pruning so `DIGEST_PENDING`, `REVIEW_PENDING`, and `POSTED_DIGEST` records are not accidentally deleted as disposable skipped records.

## Out Of Scope

- AI ranking among throttled items.
- LLM-based story clustering or editorial review.
- Thread-quality rule changes beyond digest fallback behavior in this block.
- Per-user notification preferences.
- Sports schedule integration.
- External queue infrastructure.

## Drift Risks

- Block 2-8 digest infrastructure exists in code, so Block 2-9 should integrate with it instead of introducing a parallel digest mechanism.
- Existing docs must stay aligned with the new posting-control policy semantics.
- Existing topics without `postingControls` must preserve current behavior.
- Source, intent, and topic controls must be reusable across topics; do not create a Toronto Eats-only mechanism.
- `/refresh hours` must not remain an uncapped live-post bypass if capped topics are enabled.

## Likely Files Or Areas

- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `src/config/sources.json`
- `src/processing/postingControls.ts`
- `src/jobs/pollNews.ts`
- `src/storage/articleRepo.ts`
- `src/storage/articleStatus.ts`
- `src/bot/commands.ts`
- `docs/logic/README.md`
- `docs/data/README.md`
- `tests/`

## Acceptance Criteria

- Topics can cap immediate posts per hour/day.
- Sources and intents can have stricter caps than the topic default.
- Throttled items are not lost; digestable items are stored as `DIGEST_PENDING` with explicit route/status context.
- Topics can declare digest-first intents so non-urgent items skip immediate posting unless they meet explicit high-signal criteria.
- `toronto-eats` has a digest-heavy policy that reduces main-channel noise while preserving collected links.
- Limited live slots prefer stronger items rather than the first eligible item encountered.
- Curation logs explain cooldown, cap, digest-first, and final-route decisions.
- `/testfeed` or audit output exposes posting-control decisions clearly enough to tune policy.
- Existing topics without frequency policies preserve current behavior.
- Pruning preserves actionable digest/review records and posted digest records.
- Automated tests cover pure evaluator behavior, polling burst behavior, Toronto Eats calibration, curation-log or `/testfeed` explanations, pruning behavior, and fallback compatibility.

## Verification

- `npm test`
- `npm run build`
- Run pure evaluator tests for topic caps, source caps, intent caps, cooldowns, digest-first routing, immediate escape hatches, and default-preserving behavior.
- Simulate a burst of eligible items and verify only the configured number post immediately while the rest are routed according to policy.
- Simulate a high-volume `toronto-eats` burst and verify lower-urgency items are digest-routed while one high-signal item can still post immediately.
