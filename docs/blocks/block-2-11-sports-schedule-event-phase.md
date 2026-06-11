# Block 2-11: Sports Team Context & Event Phase

> Status: Planned.
> Result: Not implemented.
> Notes: Adds season-schedule-aware sports routing for MLB/Blue Jays and NBA/Raptors after content intent, digest, and posting-frequency controls are in place.

## Goal

Let a topic declare that it follows a known sports team, then use locally cached season schedules to classify Blue Jays and Raptors items by event phase, such as pre-game, lineup, live-game, result, post-game, reaction, analysis, and evergreen. Schedule APIs should be treated as occasional import/sync sources, not live polling dependencies.

## Scope

- Add a topic subject model so configuration can say a topic follows a `sports_team` by slug, such as `toronto-blue-jays` or `toronto-raptors`.
- Add an internal team registry mapping supported slugs to provider details, team IDs, aliases, league, timezone, and schedule provider.
- Add a schedule provider abstraction that can sync season or wide-window schedules for MLB and NBA teams.
- Support Blue Jays and Raptors first through built-in registry entries, without requiring normal topic config to expose provider IDs directly.
- Cache schedule results locally and classify articles against the cache during normal news polling.
- Add refresh policy configuration:
  - regular season schedules refresh infrequently, such as daily or weekly;
  - game-day classification should not require an external API call;
  - NBA Cup / mid-season tournament windows refresh more often;
  - MLB/NBA playoffs and play-in windows refresh daily because matchups and start times are set round-by-round;
  - postponed or rescheduled games should be corrected on the next successful schedule sync.
- Add deterministic event-phase classification using game windows plus title/summary/source clues.
- Store `eventPhase`, optional `eventId`, confidence, and classification reasons with article metadata or explicit database columns.
- Route sports items differently by phase, such as:
  - `lineup` and important `pre_game` items to a game thread or immediate lane.
  - `live_game` injury/status updates to immediate or game-thread lanes.
  - `result` items to immediate posting.
  - `post_game`, `reaction`, and `analysis` to thread or digest lanes.
- Include event phase in `/testfeed`, `/audit`, and curation logs.

## Out Of Scope

- Live play-by-play ingestion.
- Live scoreboard polling as a required dependency for event-phase classification.
- Betting/odds feeds.
- Player stat dashboards.
- Automated game-thread creation beyond using the existing thread/posting primitives.
- Discovery of non-sports events such as AI conferences or gaming showcases.

## Likely Files Or Areas

- `src/config/loadConfig.ts`
- `src/config/topics.json`
- `src/services/`
- `src/processing/`
- `src/jobs/pollNews.ts`
- `src/storage/articleRepo.ts`
- `prisma/schema.prisma`
- `src/bot/commands.ts`
- `tests/`

## Acceptance Criteria

- Blue Jays and Raptors topics can declare a simple subject, such as `sports_team:toronto-blue-jays` or `sports_team:toronto-raptors`.
- Provider-specific team IDs live in an internal registry instead of normal topic config.
- Schedule data is fetched through a provider abstraction, cached locally, and reused by article classification.
- Regular-season classification uses cached schedule data without making per-article or per-poll external schedule requests.
- Schedule refresh cadence can be configured for regular season, tournament/cup, and playoff windows.
- Articles near known game windows receive an event phase with confidence and reasons.
- Result, lineup, live injury/status, post-game reaction, and analysis examples classify differently under tests.
- Sports routing policies can use event phase in addition to content intent.
- If schedule fetching fails, the bot logs the issue and continues using the last successful cache when available, otherwise falling back to title/time-only classification without crashing.
- Automated tests cover MLB and NBA schedule fixtures, cache behavior, refresh cadence selection, phase classification, stale-cache fallback, and no-cache fallback behavior.

## Verification

- `npm test`
- `npm run build`
- Run mocked MLB and NBA schedule fixtures through the classifier and verify `/testfeed` explains event phase and route.
