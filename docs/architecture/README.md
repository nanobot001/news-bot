# Architecture

## MVP Pipeline

The project must be structured as a small event pipeline:

```txt
raw source -> normalized event -> dedupe -> scoring/filtering -> Discord publishing -> storage/logging
```

RSS is the first raw source, but the internal shape should not be RSS-specific after normalization.

## Initial Areas

- `src/bot/`: Discord client, command registration, and embed publishing
- `src/ingestion/`: feed fetching, RSS parsing, and source registry
- `src/normalization/`: RSS item to normalized event conversion
- `src/processing/`: dedupe, scoring, and filtering
- `src/storage/`: Prisma client and article repository
- `src/jobs/`: scheduled polling job
- `src/config/`: topic and source config
- `prisma/`: SQLite schema

## Future Harness Shape

The future harness should evolve toward:

```txt
sources
-> source adapters
-> normalized events
-> bot/agent profile
   -> instructions
   -> permissions
   -> memory scope
   -> allowed tools
-> deterministic processing rules
-> optional LLM tool use
-> memory/storage
-> publishers
-> audit logs
```

The long-term goal is one shared harness with many bot or agent identities, each with its own token, Discord identity, permissions scope, channels, command set, source access, instructions, memory scope, allowed tools, and tone/personality config.

The harness should own reusable runtime concerns: config loading, scheduling, source adapter execution, tool registration, permission checks, memory isolation, publishing, rate limits, and audit logging. Individual bot or agent profiles should own purpose, instructions, allowed tools, memory scopes, routing rules, channels, commands, and tone.

Spinning out a new bot should eventually mean adding a config profile, not rewriting the system.
