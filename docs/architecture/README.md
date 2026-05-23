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
sources -> source adapters -> normalized events -> processing rules -> memory/storage -> permissions -> LLM tools -> publishers -> Discord bots
```

The long-term goal is one shared harness with many bot identities, each with its own token, permissions scope, channels, command set, source access, and tone/personality config.
