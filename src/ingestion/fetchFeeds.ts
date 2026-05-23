import type { SourceConfig } from "./sourceRegistry.js";
import { parseRssXml, type ParsedRssItem } from "./parseRss.js";

export type FetchFeedResult = {
  sourceName: string;
  itemCount: number;
};

export type FetchFeedItemsResult = FetchFeedResult & {
  items: ParsedRssItem[];
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "news-bot/0.1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed (${response.status}) for ${url}`);
  }

  return await response.text();
}

export async function fetchFeedItems(source: SourceConfig): Promise<FetchFeedItemsResult> {
  const xml = await fetchText(source.url);
  const items = await parseRssXml(xml);

  return {
    sourceName: source.name,
    itemCount: items.length,
    items
  };
}
