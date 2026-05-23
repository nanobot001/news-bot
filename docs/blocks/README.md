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

Start with `block-01-first-verifiable-step.md`.
