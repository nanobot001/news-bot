# Block 2-8: Intent-Based Digests

> Status: Implemented.
> Result: Implemented.
> Notes: Built on Block 2-6 so non-immediate items such as discussion, review, guide, opinion, reaction, and aggregate coverage have useful scheduled lanes instead of flooding live channels.

## Goal

Provide scheduled, consolidated digest updates by topic and content intent, collecting lower-urgency items and posting compact Discord embeds at configured times.

## Scope

- Extend topic configuration to support digest policies by intent, such as separate schedules for `discussion`, `review`, `guide`, `opinion`, `reaction`, and `aggregate`.
- Add article statuses for digest lifecycle, such as `DIGEST_PENDING` and `POSTED_DIGEST`.
- Store digest-routed articles with enough metadata to query by topic, intent, source, score, and first seen time.
- Implement a scheduled digest publisher that gathers pending items for each configured topic/intent lane.
- Format digest embeds as compact lists with title links, source names, scores, and short classification labels.
- Mark articles as posted to digest after successful publishing.
- Add a manager-facing preview path, either through `/testfeed` output or a small digest preview command if that matches existing command patterns.

## Out Of Scope

- AI-written summaries.
- Per-user or personalized digests.
- Sports game-thread lifecycle behavior.
- Source adapter changes.
- Full review-queue approval workflows.

## Likely Files Or Areas

- `prisma/schema.prisma`
- `src/storage/articleRepo.ts`
- `src/storage/articleStatus.ts`
- `src/jobs/`
- `src/bot/postEmbed.ts`
- `src/bot/commands.ts`
- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `tests/`

## Acceptance Criteria

- Items routed to digest by Block 2-6 are stored without immediate main-channel posting.
- Digest jobs run on configured schedules for topic/intent lanes.
- Digest embeds clearly separate or label content intent so discussion/review/opinion items do not look like breaking news.
- Successfully published digest items are marked `POSTED_DIGEST`.
- Digest jobs avoid reposting the same item on later runs.
- Automated tests cover digest accumulation, retrieval, formatting, publishing success, and idempotency.

## Verification

- `npm test`
- `npm run build`
- Configure a short test digest schedule, ingest representative digest-routed items, and verify a compact digest appears in Discord or in a mocked publisher test.
