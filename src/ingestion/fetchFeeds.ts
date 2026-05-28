import type { SourceConfig } from "./sourceRegistry.js";
import { parseRssXml, type ParsedRssItem } from "./parseRss.js";

export type FetchFeedResult = {
  sourceName: string;
  itemCount: number;
};

export type FetchFeedItemsResult = FetchFeedResult & {
  items: ParsedRssItem[];
};

function getRsshubBaseUrl(): string | null {
  const raw = (process.env.RSSHUB_BASE_URL || "").trim();
  if (!raw) return null;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getYoutubeChannelIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.youtube.com" && parsed.hostname !== "youtube.com") return null;
    
    // Format 1: /feeds/videos.xml?channel_id=UC...
    if (parsed.pathname === "/feeds/videos.xml") {
      const id = parsed.searchParams.get("channel_id");
      return id && id.startsWith("UC") ? id : null;
    }

    // Format 2: /channel/UC...
    if (parsed.pathname.startsWith("/channel/")) {
      const parts = parsed.pathname.split("/");
      const id = parts[2];
      return id && id.startsWith("UC") ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

function getYoutubeHandleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.youtube.com" && parsed.hostname !== "youtube.com") return null;
    if (parsed.pathname.startsWith("/@")) {
      const parts = parsed.pathname.split("/");
      return parts[1]; // e.g. "@username"
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchText(url: string): Promise<string> {
  const timeoutMs = 8000;
  const maxRetries = 3;
  const baseDelayMs = 200;
  let lastError: any;

  const ytChannelId = getYoutubeChannelIdFromUrl(url);
  const ytHandle = getYoutubeHandleFromUrl(url);
  let fetchUrl = url;

  if (ytChannelId && !url.includes("/feeds/videos.xml")) {
    fetchUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ytChannelId}`;
  } else if (ytHandle) {
    const rsshubBaseUrl = getRsshubBaseUrl();
    if (rsshubBaseUrl) {
      fetchUrl = `${rsshubBaseUrl}/youtube/user/${ytHandle}`;
    } else {
      throw new Error(`Cannot fetch YouTube handle URL "${url}" because RSSHUB_BASE_URL is not configured. Please use a channel ID URL (e.g. /channel/UC...) or configure RSSHUB_BASE_URL.`);
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      try {
        const response = await fetch(fetchUrl, {
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
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "connection": "close"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        const fallbackYtChannelId = getYoutubeChannelIdFromUrl(fetchUrl);
        const rsshubBaseUrl = getRsshubBaseUrl();
        if (fallbackYtChannelId && rsshubBaseUrl && !fetchUrl.includes(rsshubBaseUrl)) {
          const rsshubUrl = `${rsshubBaseUrl}/youtube/channel/${fallbackYtChannelId}`;
          const rsshubResponse = await fetch(rsshubUrl, {
            headers: {
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "connection": "close"
            },
            signal: AbortSignal.timeout(timeoutMs)
          });
          if (!rsshubResponse.ok) {
            throw new Error(`RSS fetch failed (${response.status}) for ${fetchUrl} and RSSHub fallback failed (${rsshubResponse.status}) for ${rsshubUrl}`);
          }
          return await rsshubResponse.text();
        }

        throw new Error(`RSS fetch failed (${response.status}) for ${fetchUrl}`);
      }

      return await response.text();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }

  throw lastError || new Error(`RSS fetch failed for ${url} after ${maxRetries} attempts`);
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
