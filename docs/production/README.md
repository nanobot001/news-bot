# Production

## Runtime

The bot should run as a Node.js process configured through `.env`.

Expected environment values:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` for development command registration
- `DATABASE_URL` for SQLite, for example `file:./dev.db`
- `NODE_ENV`
- `POLL_CRON`

## Discord Constraints

Credentials belong only in `.env`. Channel IDs belong in topic config. The bot should post only to configured channels and should keep embeds short and readable.

## Logging

The MVP should log checked, new, skipped, and posted counts per topic during polling.

## Deployment Notes

No deployment target is selected yet. Do not add Docker, Kubernetes, Redis, dashboards, or monitoring infrastructure during the MVP seed.
