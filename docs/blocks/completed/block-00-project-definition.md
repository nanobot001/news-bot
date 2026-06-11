# Block 00: Project Definition

## Goal

Lock the attached roadmap as the project definition for a Discord news bot MVP and future reusable bot harness.

## Scope

- Treat `docs/project-charter.md` as the top-level authority.
- Preserve the MVP stack: Node.js, TypeScript, `discord.js`, `rss-parser`, SQLite, Prisma, `node-cron`, and `dotenv`.
- Preserve the event pipeline: raw source to normalized event to dedupe to scoring/filtering to Discord publishing to storage/logging.
- Preserve the non-goals for MVP.

## Out Of Scope

- Installing dependencies
- Implementing runtime bot behavior
- Adding LLM features, dashboards, Redis, vector search, or multi-server tenancy

## Acceptance Criteria

- Charter and supporting docs reflect the explicit roadmap.
- Block index points to the next implementation block.
- The project direction is clear without asking generic charter questions.

## Verification

Read `docs/project-charter.md`, `docs/architecture/README.md`, `docs/data/README.md`, and `docs/blocks/README.md`.
