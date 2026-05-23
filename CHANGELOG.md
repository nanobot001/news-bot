# Changelog

## [Unreleased]

### Added
- **Block 06 (Scheduled Polling)**: Pipeline integration runner using node-cron. Features feed failure tolerance, human-readable structured logging with conditional verbosity, and test suites with global fetch mocks.
- **Block 05 (Discord Embeds)**: Formatting and channel publishing logic using Discord.js. Supports rich embeds with conditional score/debug footers in development mode, automated mock test suite, and a live manual runner.
- **Block 04 (Scoring & Filtering)**: Deterministic keyword scoring, topic eligibility thresholds, trusted source boosts, and blocked term filtering.
- **Block 03 (SQLite Dedupe Storage)**: Prisma SQLite storage layer and canonical URL/title hashing deduplication logic.
- Initial project scaffold.
