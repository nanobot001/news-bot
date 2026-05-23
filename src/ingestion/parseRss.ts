import Parser from "rss-parser";

export type ParsedRssItem = {
  guid?: string;
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  raw?: unknown;
};

const parser = new Parser();

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function parseRssXml(xml: string): Promise<ParsedRssItem[]> {
  const feed = await parser.parseString(xml);

  return (feed.items ?? []).map((item) => {
    // rss-parser item shape is loose; keep a copy on `raw`.
    const raw = item as unknown;
    const anyItem = item as unknown as Record<string, unknown>;

    return {
      guid: cleanOptionalString(anyItem.guid),
      title: cleanOptionalString(anyItem.title),
      link: cleanOptionalString(anyItem.link),
      pubDate: cleanOptionalString(anyItem.pubDate),
      contentSnippet: cleanOptionalString(anyItem.contentSnippet ?? anyItem.content),
      raw
    };
  });
}
