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

## Sources Config

`src/config/sources.json` maps topic names to RSS sources:

- Source name
- RSS URL
- Trust flag

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
- Raw JSON

Deduplication should check RSS GUID when available, canonical URL hash, and title hash fallback.
