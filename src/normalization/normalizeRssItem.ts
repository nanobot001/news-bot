import type { ParsedRssItem } from "../ingestion/parseRss.js";
import type { SourceConfig } from "../ingestion/sourceRegistry.js";
import type { NormalizedEvent } from "./normalizedEvent.js";

export type NormalizeRssInput = {
  topic: string;
  source: SourceConfig;
  item: ParsedRssItem;
};

export type NormalizeRssItem = (input: NormalizeRssInput) => NormalizedEvent;

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredString(value: unknown, fallback: string): string {
  return cleanOptionalString(value) ?? fallback;
}

export const normalizeRssItem: NormalizeRssItem = ({ topic, source, item }) => {
  const title = requiredString(item.title, "Untitled article");
  const url = cleanOptionalString(item.link) ?? "";

  const preferredId = cleanOptionalString(item.guid) ?? cleanOptionalString(item.link);
  const id = preferredId ?? `${source.name}:${title}`;

  const publishedAt = cleanOptionalString(item.pubDate);
  const summary = cleanOptionalString(item.contentSnippet);

  const raw = item.raw ?? item;

  return {
    id,
    type: "news.article",
    topic,
    title,
    url,
    sourceName: source.name,
    publishedAt,
    summary,
    raw
  };
};
