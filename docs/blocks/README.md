# Blocks

Implement one block at a time. The roadmap in `docs/project-charter.md` is authoritative for MVP direction.

Keep active, not-yet-implemented blocks directly in this folder. Move completed blocks to `docs/blocks/completed/` so the active queue stays easy to scan.

## Active Block Queue

1. `block-2-9-posting-frequency-controls.md`: Per-topic, per-source, and per-intent cooldowns and posting caps.
2. `block-2-11-sports-schedule-event-phase.md`: Blue Jays and Raptors sports team context with cached season schedules and event phase routing.
3. `block-2-12-assisted-event-context-discovery.md`: Manager-approved discovery of event contexts for topics such as AI, gaming, conferences, elections, and product launches.
4. `block-2-13-story-signal-clustering.md`: Topic-agnostic story signal extraction and clustering so related coverage can attach by story meaning instead of only title word overlap.

## Future Candidate Blocks

- Phase 4 source adapter boundary: shared interface for RSS and later non-RSS sources.
- Phase 4 X API recent search adapter: read-only X/Twitter source ingestion with normalized events.
- Phase 4 X API cost and rate safety: per-source result caps, daily post caps, budget logging, and disabled-by-default config.
- Phase 4 social source scoring rules: trusted handles, engagement gates, repost exclusion, language filters, and keyword safeguards.

## Completed Blocks

Completed block tickets live in `docs/blocks/completed/`.

### MVP

1. `completed/block-00-project-definition.md`: locked project definition extracted from the roadmap.
2. `completed/block-01-first-verifiable-step.md`: runnable TypeScript shell with config loading and Discord bootstrap prepared for `/ping`.
3. `completed/block-02-normalized-rss-ingestion.md`: fetch RSS sources and normalize items into `NormalizedEvent`.
4. `completed/block-03-sqlite-dedupe-storage.md`: Prisma SQLite schema, article repository, and dedupe checks.
5. `completed/block-04-scoring-filtering.md`: deterministic scoring and eligibility filtering.
6. `completed/block-05-discord-embeds.md`: post eligible articles as clean Discord embeds.
7. `completed/block-06-scheduled-polling.md`: scheduled poll job with topic/source counts.
8. `completed/block-07-mvp-commands.md`: `/testfeed`, `/lastposts`, and `/reload-config`.
9. `completed/block-08-readme-setup-verification.md`: final setup docs and MVP verification pass.

### Phase 2 Curation Enhancements

1. `completed/block-2-1-heart-reaction-favorites.md`: Heart reactions on posted articles, local favorite recall, and optional Instapaper Simple API saves.
2. `completed/block-2-2-reaction-email-forwarding.md`: Dedicated reaction forwarding that emails the article URL and metadata to a configured recipient.
3. `completed/block-2-3-bot-manager-auth-audit.md`: Bot manager command gates, `/audit <topic>` slash command, and database-backed curation skip/filter logs.
4. `completed/block-2-4-topic-source-management.md`: Bot manager `/topic` and `/source` commands for file-backed topic and RSS source configuration.
5. `completed/block-2-5-topic-keyword-management.md`: Unified `/keyword` command for full keyword inspection plus bot-manager add/remove operations that persist to config.
6. `completed/block-2-6-content-intent-routing.md`: Deterministic content intent classification and editorial routing for immediate, thread, digest, review, and skip lanes.
7. `completed/block-2-7-similarity-clustering.md`: In-memory Jaccard similarity grouping on title tokens and appending related coverage links to existing embeds.
8. `completed/block-2-8-intent-based-digests.md`: Scheduled digest lanes by topic and content intent for lower-urgency items.
9. `completed/block-2-10-manual-article-removal.md`: Message context menu commands, modals, article retraction, and culprit keyword diagnostic audit logs.
