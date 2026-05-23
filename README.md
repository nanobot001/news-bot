# Discord News Bot

A Discord news-gathering bot MVP that polls curated RSS feeds, normalizes articles into an internal event format, deduplicates and scores them, and posts clean Discord embeds into topic-specific channels.

This project is intentionally structured as a small event pipeline, not a one-off RSS-to-Discord script:

```txt
raw source -> normalized event -> dedupe -> scoring/filtering -> Discord publishing -> storage/logging
```

The MVP source is RSS. The long-term direction is a reusable bot harness that can support sources such as Plex alerts, Reddit digests, Gmail summaries, workflow monitors, and topic-specific Discord assistants.

## Status

Initial project seed only. Dependencies are listed in `package.json` but are not installed yet, and runtime behavior is intentionally skeletal until the first implementation block is completed.

## MVP Stack

- Node.js
- TypeScript
- discord.js
- rss-parser
- SQLite
- Prisma
- node-cron
- dotenv

## Setup Direction

1. Install dependencies after the first implementation block is selected:

```powershell
npm install
```

2. Copy `.env.example` to `.env` and fill in real Discord values. Do not commit `.env`.
3. Configure topic channels in `src/config/topics.json`.
4. Configure RSS sources in `src/config/sources.json`.
5. Run Prisma setup once the storage block is implemented.
6. Start with the next block in `docs/blocks/README.md`.

## Project Docs

- `docs/project-charter.md` is the top-level project authority.
- `docs/blocks/` contains AI-buildable implementation tickets.
- `docs/architecture/README.md` describes the event pipeline and future harness shape.
- `docs/data/README.md` defines the normalized event and storage expectations.
- `docs/logic/README.md` captures dedupe, scoring, filtering, and polling rules.
- `docs/continue-here.md` captures current handoff state.

## MVP Commands

The MVP should eventually expose:

- `/ping`
- `/testfeed <topic>`
- `/lastposts <topic>`
- `/reload-config`

## Non-Goals For MVP

Do not add LLM summaries, vector search, dashboards, Redis, multi-server tenancy, Kubernetes, advanced agent tools, or complex permission systems during the MVP.
