# Blocks

Implement one block at a time. The roadmap in `docs/project-charter.md` is authoritative for MVP direction.

## MVP Block Sequence

1. `block-00-project-definition.md`: locked project definition extracted from the roadmap.
2. `block-01-first-verifiable-step.md`: runnable TypeScript shell with config loading and Discord bootstrap prepared for `/ping`.
3. `block-02-normalized-rss-ingestion.md`: fetch RSS sources and normalize items into `NormalizedEvent`.
4. `block-03-sqlite-dedupe-storage.md`: Prisma SQLite schema, article repository, and dedupe checks.
5. `block-04-scoring-filtering.md`: deterministic scoring and eligibility filtering.
6. `block-05-discord-embeds.md`: post eligible articles as clean Discord embeds.
7. `block-06-scheduled-polling.md`: scheduled poll job with topic/source counts.
8. `block-07-mvp-commands.md`: `/testfeed`, `/lastposts`, and `/reload-config`.
9. `block-08-readme-setup-verification.md`: final setup docs and MVP verification pass.

## Phase 2 Block Sequence: Curation Enhancements

1. `block-2-1-heart-reaction-favorites.md`: Heart reactions on posted articles, local favorite recall, and optional Instapaper Simple API saves.
2. `block-2-2-reaction-email-forwarding.md`: Dedicated reaction forwarding that emails the article URL and metadata to a configured recipient.
3. `block-2-3-bot-manager-auth-audit.md`: Bot manager command gates, `/audit <topic>` slash command, and database-backed curation skip/filter logs.
4. `block-2-4-topic-source-management.md`: Bot manager `/topic` and `/source` commands for file-backed topic and RSS source configuration.
5. `block-2-5-topic-keyword-management.md`: Unified `/keyword` command for full keyword inspection plus bot-manager add/remove operations that persist to config.
6. `block-2-6-advanced-trust-rules.md`: Multi-tier source trust levels, priority weighting, and source-level custom scoring modifiers.
7. `block-2-7-topic-throttling.md`: Topic-specific pacing limits, cooldown checks, and database-backed deferred article queues.
8. `block-2-8-similarity-clustering.md`: In-memory Jaccard similarity grouping on title tokens and appending related coverage links to existing embeds.
9. `block-2-9-daily-digests.md`: Digest eligibility thresholds, accumulation storage, and scheduled daily/weekly summary publishers.
