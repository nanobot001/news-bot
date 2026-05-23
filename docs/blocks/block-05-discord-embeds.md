# Block 05: Discord Embeds

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
