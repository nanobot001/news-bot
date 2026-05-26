# Project Charter

## Purpose

Build a Discord news-gathering bot that polls curated RSS feeds, filters and deduplicates articles, scores relevance by topic, and posts clean Discord embeds into topic-specific channels.

The MVP should be boring, reliable, and extensible. It must not become a one-off RSS-to-Discord script.

## Audience

The immediate user is a Discord server owner or operator who wants topic-specific news posts without manually checking feeds. Future users may reuse the same harness for other Discord bot identities and event sources.

## Core Design Principle

Use a small event pipeline:

```txt
raw source -> normalized event -> dedupe -> scoring/filtering -> Discord publishing -> storage/logging
```

RSS is the first source. The architecture should make later sources possible without rewriting the whole bot.

## MVP Scope

Must have:

- Node.js and TypeScript project
- Discord bot using `discord.js`
- RSS polling using a parser library
- Topic configuration file
- Source configuration file
- SQLite database
- Prisma storage layer
- Basic deduplication
- Basic relevance scoring
- Discord embed posting
- Scheduled polling
- Slash commands: `/ping`, `/testfeed <topic>`, `/lastposts <topic>`, `/reload-config`

## Success Criteria

The MVP is complete when:

- Bot starts successfully from `.env`
- Bot connects to Discord
- RSS feeds are polled on schedule
- Articles normalize into a shared internal event format
- Duplicate articles are not reposted
- Articles are scored deterministically
- Eligible articles post to the correct Discord channel
- MVP commands work
- SQLite persists posted articles
- Logs show checked, new, skipped, and posted counts per topic
- README explains setup and local run steps

## Roadmap

Phase 1 is the MVP news bot: RSS to normalized news event to dedupe to score to Discord embed to SQLite.

Phase 2 improves live curation and operations with heart reaction favorites, favorite recall, optional Instapaper saves, reaction-based email forwarding, bot manager command authorization, Discord-side topic/source management, keyword tuning, better trust levels, per-topic posting limits, daily digests, grouped related articles, and improved logging.

Phase 3 adds optional LLM-assisted curation for summaries, classification, "why it matters" explanations, posting decisions, and daily digest summaries. LLMs must not replace deterministic dedupe or baseline rules. This phase should begin introducing agent-shaped boundaries, where LLM behavior is governed by explicit instructions, allowed tools, memory scope, and audit logs.

Phase 4 adds multiple source adapters such as Plex/Tautulli events, Reddit saved items, Gmail summaries, GitHub releases, and local script or webhook events.

Phase 5 supports multiple bot identities from shared backend config, such as news, Plex, Reddit, Gmail, and admin bots. Each bot identity should have its own token, Discord identity, permissions scope, channels, command set, source access, instructions, memory scope, allowed tools, and tone/personality config.

The future harness goal is one shared runtime with many configured bot or agent identities. Spinning out a new bot should eventually mean adding a config profile, not rewriting the system.

## Non-Goals For MVP

Do not implement:

- Vector database
- Semantic memory
- Dashboard
- User profiles
- Cross-server tenancy
- Complex permissions
- Auto-source discovery
- AI chat
- Reaction-based learning
- Redis queue
- Kubernetes
- Advanced agent tools

## Document Map

- `docs/blocks/README.md`: implementation block index
- `docs/architecture/README.md`: event pipeline and harness architecture
- `docs/data/README.md`: normalized events, config contracts, and SQLite storage
- `docs/logic/README.md`: dedupe, scoring, filtering, and scheduler rules
- `docs/production/README.md`: runtime environment and operational notes
- `docs/testing/README.md`: acceptance and verification scenarios
- `docs/continue-here.md`: current state and next step
