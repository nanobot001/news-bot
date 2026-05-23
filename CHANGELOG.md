# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.0] - 2026-05-23

### Added
- **Block 08 (README Setup & MVP Verification)**: Completed installation, configuration, database setup, execution, and verification documentation. Added detailed manual smoke testing guidelines.
- **Block 07 (MVP Commands)**: Registered `/testfeed`, `/lastposts`, and `/reload-config` slash commands. Implemented in-memory configuration reloading, query helper for recently posted articles, and startup guild command auto-registration.
- **Block 06 (Scheduled Polling)**: Pipeline integration runner using node-cron. Features feed failure tolerance, human-readable structured logging with conditional verbosity, and test suites with global fetch mocks.
- **Block 05 (Discord Embeds)**: Formatting and channel publishing logic using Discord.js. Supports rich embeds with conditional score/debug footers in development mode, automated mock test suite, and a live manual runner.
- **Block 04 (Scoring & Filtering)**: Deterministic keyword scoring, topic eligibility thresholds, trusted source boosts, and blocked term filtering.
- **Block 03 (SQLite Dedupe Storage)**: Prisma SQLite storage layer and canonical URL/title hashing deduplication logic.
- Initial project scaffold.
