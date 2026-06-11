# Data

## Normalized Event

The MVP normalized event contract is:

```ts
export type NormalizedEvent = {
  id: string;
  type: "news.article";
  topic: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt?: string;
  summary?: string;
  raw?: unknown;
};
```

Future event types may include `plex.new_media`, `reddit.saved_item`, and `gmail.important_email`.

## Topic Config

`src/config/topics.json` maps topic names to:

- Discord channel ID
- Keywords
- Blocked terms
- Post threshold
- Optional intent routing policies keyed by content intent

## Sources Config

`src/config/sources.json` maps topic names to RSS sources:

- Source name
- RSS URL
- Trust flag
- Optional default content intent, tier, and route hint

## Content Intent And Routes

Content intent is deterministic editorial metadata assigned during polling. Supported intents are:

- `news`
- `official`
- `review`
- `guide`
- `opinion`
- `discussion`
- `reaction`
- `aggregate`
- `mixed`

Supported routes are:

- `immediate_post`
- `thread_only`
- `digest_pending`
- `review_pending`
- `skip`

Existing topics without `intentRouting` preserve legacy posting behavior except for built-in hybrid defaults: Reddit/forum-like sources default to `discussion`, and Google News search feeds default to `aggregate`.

## SQLite Storage

Store:

- Article ID
- URL
- URL hash
- Title
- Title hash
- Topic
- Source
- Published date
- First seen date
- Posted date
- Score
- Status (`INDEXED`, `POSTED`, or a `SKIPPED_*` status)
- Status reason for filter/audit context
- Intent
- Intent confidence
- Route
- Route reason
- Raw JSON

Deduplication should check RSS GUID when available, canonical URL hash, and title hash fallback.
