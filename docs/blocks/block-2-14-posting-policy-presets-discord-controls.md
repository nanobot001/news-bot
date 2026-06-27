# Block 2-14: Posting Policy Presets, Discord Controls, and Recommendations

> Status: Planned.
> Result: Not implemented.
> Notes: Builds on Block 2-9 so posting-frequency controls can be reused, adjusted from Discord, and guided by deterministic recommendations without autonomous self-tuning.

## Goal

Make posting controls practical to operate across many topics. Bot managers should be able to apply a small set of reusable policy presets, inspect the active policy for a topic or source, make narrow adjustments from Discord, and ask the bot for recommendation-only guidance based on recent curation behavior.

## Scope

- Add reusable posting policy presets for common topic shapes such as `live-heavy`, `balanced`, `digest-heavy`, and `aggregate-throttled`.
- Let a topic choose a preset, then optionally override specific fields such as cooldown, per-hour cap, per-day cap, digest-first intents, or source-level stricter limits.
- Add manager-facing Discord commands to view and edit posting policy settings without directly editing JSON files.
- Add a recommendation-only command that summarizes recent posting-control behavior for a topic and suggests safe adjustments.
- Include recommendation inputs such as recent immediate post volume, digest volume, throttled-by-source counts, throttled-by-intent counts, removal or audit signals, and shallow useful-item pressure where already available.
- Keep recommendations deterministic and explainable, with clear reasons and no silent automatic config mutation.
- Persist approved policy edits back to the existing file-backed config model.

## Out Of Scope

- Fully autonomous self-tuning that edits topic policy without manager approval.
- LLM-generated recommendations or Gemini-dependent policy changes.
- Redesign of Block 2-9 evaluation semantics.
- Schedule-aware sports policy tuning beyond what Block 2-11 may later provide.
- Large analytics dashboards or non-Discord admin UI.

## Likely Files Or Areas

- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `src/config/sources.json`
- `src/processing/postingControls.ts`
- `src/bot/commands.ts`
- `src/storage/articleRepo.ts`
- `docs/data/README.md`
- `docs/logic/README.md`
- `tests/`

## Acceptance Criteria

- The config layer supports named posting policy presets plus topic-level overrides.
- A bot manager can inspect the current posting policy for a topic from Discord, including preset source and effective overrides.
- A bot manager can apply a preset to a topic from Discord and persist that change to config.
- A bot manager can change narrow policy fields from Discord, such as cooldown, daily or hourly caps, or digest-first intents, without manually editing JSON.
- A bot manager can inspect source-level stricter controls for a topic and update them from Discord in the first pass, either through dedicated source policy commands or clearly scoped source subcommands.
- A recommendation command can summarize recent posting-control behavior for a topic and propose changes, but does not apply them automatically.
- Recommendation output is deterministic, cites the signals used, and distinguishes between `observe`, `consider`, and `recommended` adjustments.
- Topics without a selected preset continue to work using explicit existing config.
- Automated tests cover preset expansion, override precedence, Discord command persistence, recommendation summaries, and safety around no-op or partial updates.

## Verification

- `npm test`
- `npm run build`
- Use Discord commands in a manager-only test flow to:
- view a topic policy
- apply a preset
- adjust one cap
- request recommendations
- confirm config files and `/topics` output reflect the effective policy
