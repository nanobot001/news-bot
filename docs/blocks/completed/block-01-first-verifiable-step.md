# Block 01: First Verifiable Step

> Status: Implemented on 2026-05-23.
> Result: Implemented.
> Verification: `npm install` - passed; `npm run typecheck` - passed; `npm run dev` - passed.
> Notes: The TypeScript bot shell loads `.env`, validates topic/source config, prepares `/ping`, creates a Discord client, and successfully connected during verification.

## Goal

Create the smallest runnable TypeScript project shell for the Discord news bot.

## Scope

- Install the dependencies declared in `package.json`.
- Add a TypeScript entrypoint that loads `.env`.
- Load and validate `src/config/topics.json` and `src/config/sources.json`.
- Initialize a Discord client in `src/bot/discordClient.ts`.
- Prepare `/ping` command registration shape in `src/bot/commands.ts`.
- Ensure the app can start without polling RSS or posting news yet.

## Out Of Scope

- RSS fetching
- SQLite persistence
- Deduplication
- Scoring
- Scheduled polling
- Posting article embeds
- Implementing the remaining MVP commands

## Likely Files

- `package.json`
- `tsconfig.json`
- `.env.example`
- `src/index.ts`
- `src/bot/discordClient.ts`
- `src/bot/commands.ts`
- `src/config/topics.json`
- `src/config/sources.json`

## Acceptance Criteria

- `npm install` succeeds.
- `npm run typecheck` succeeds.
- `npm run dev` starts the bot shell when `.env` is populated.
- Missing required environment values produce a clear error.
- Config loading fails clearly for malformed topic/source JSON.
- `/ping` command implementation path is ready for Discord registration.

## Verification

Run:

```powershell
npm install
npm run typecheck
npm run dev
```
