# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- **Block 2-1 (Heart Reaction Favorites & Instapaper Sync)**: Added SQLite schema for `UserFavorite` and updated `Article` model with Discord message IDs. Implemented `/favorites` recall slash command with topic, query, source, and relative timeframe filters. Implemented optional Instapaper Simple API integration for syncing favorites, and registered Discord reaction listener to capture heart emojis on posted embeds. Added two-way favorite removal via reaction removal (un-hearting) and the `/unfavorite` slash command with real-time autocomplete suggestions. Added unit testing suite in `tests/favorites.test.ts` and expanded command coverage in `tests/bot.test.ts`. (2026-05-25)

## [0.1.0] - 2026-05-23

### Added
- **Additional Slash Commands**: Registered and implemented `/refresh` (force-refresh feeds), `/stats` (database record metrics), `/search` (article database queries), `/topics` (active configurations list), and `/sources` (feed credentials and configurations list).
- **Expanded Command Test Coverage**: Added mock interaction unit tests in `tests/bot.test.ts` for database stats, command authorization routes, and article keyword searching.
- **Phase 2 Block Specifications**: Added specifications for curation enhancements (`block-2-1` through `block-2-5`) to define admin gates, trust levels, throttling cooldowns, similarity clustering, and daily digests.
- **Block 08 (README Setup & MVP Verification)**: Completed installation, configuration, database setup, execution, and verification documentation. Added detailed manual smoke testing guidelines.
- **Block 07 (MVP Commands)**: Registered `/testfeed`, `/lastposts`, and `/reload-config` slash commands. Implemented in-memory configuration reloading, query helper for recently posted articles, and startup guild command auto-registration.

- **Block 06 (Scheduled Polling)**: Pipeline integration runner using node-cron. Features feed failure tolerance, human-readable structured logging with conditional verbosity, and test suites with global fetch mocks.
- **Block 05 (Discord Embeds)**: Formatting and channel publishing logic using Discord.js. Supports rich embeds with conditional score/debug footers in development mode, automated mock test suite, and a live manual runner.
- **Block 04 (Scoring & Filtering)**: Deterministic keyword scoring, topic eligibility thresholds, trusted source boosts, and blocked term filtering.
- **Block 03 (SQLite Dedupe Storage)**: Prisma SQLite storage layer and canonical URL/title hashing deduplication logic.
- Initial project scaffold.
