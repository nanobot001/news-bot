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
  const timeoutMs = 8000;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "news-bot/0.1.0"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    // Fallback to browser user agent
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    signal: AbortSignal.timeout(timeoutMs)
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
