# Testing

## MVP Acceptance Scenarios

Verify:

- Bot starts from `.env`
- Bot connects to Discord
- `/ping` returns a live response
- RSS feeds are polled on schedule
- RSS items normalize into `NormalizedEvent`
- Duplicate articles are not reposted
- Relevance scoring is deterministic
- Eligible articles post to the configured Discord channel
- `/testfeed <topic>` reports feeds checked, items found, new items, and posts eligible
- `/lastposts <topic>` shows recently posted items
- `/reload-config` reloads topic and source files without restart
- SQLite persists article records
- Logs show checked, new, skipped, and posted counts per topic

## Initial Verification

For the seeded project, verify the project structure and docs exist. Runtime tests are expected to arrive with implementation blocks because dependencies are not installed during seeding.
