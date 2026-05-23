# Block 05: Discord Embeds

> Status: Implemented on 2026-05-23.
> Result: Implemented.
> Verification: `npm run test:all` - passed. Also verified via live post runner `scripts/test-embed.ts`.
> Notes: Formats eligible news articles into rich Discord embeds and posts them to target channels based on config mapping, with score details rendered in dev mode.

## Goal

Post eligible articles to the correct Discord topic channel as clean embeds.

## Scope

- Build article embed formatting.
- Use topic channel IDs from config.
- Include title, source, short description when available, published time when available, and link.
- Include score/debug footer only in development mode.

## Out Of Scope

- Scheduling
- Full command suite
- Admin permissions

## Acceptance Criteria

- Eligible article events publish to the configured channel.
- Embeds remain short and readable.
- Missing optional fields do not crash publishing.

## Verification

Run typecheck and a controlled manual post test in a development Discord channel.
