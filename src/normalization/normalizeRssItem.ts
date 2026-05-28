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

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/**
 * Helper to clean prefixes and suffixes from source/publisher names.
 */
function cleanSourceName(name: string): string {
  let cleaned = name;
  if (cleaned.startsWith("Google News - ")) {
    cleaned = cleaned.replace("Google News - ", "");
  }
  const suffixes = [
    " Food",
    " Blue Jays",
    " Raptors",
    " Restaurant News",
    " Local News",
    " General"
  ];
  for (const suffix of suffixes) {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length);
    }
  }
  return cleaned.trim();
}

/**
 * Helper to parse a potential author prefix from an article title.
 * E.g. "Bontemps: Why Joel Embiid..." -> { author: "Bontemps", cleanedTitle: "Why Joel Embiid..." }
 */
function parseAuthorFromTitle(title: string): { author?: string; cleanedTitle: string } {
  const colonIndex = title.indexOf(":");
  if (colonIndex === -1) {
    return { cleanedTitle: title };
  }

  const prefix = title.slice(0, colonIndex).trim();
  const restOfTitle = title.slice(colonIndex + 1).trim();

  // If the rest of the title is empty, it's not a valid prefix format
  if (restOfTitle.length === 0) {
    return { cleanedTitle: title };
  }

  // Strip leading "By " case-insensitively
  const cleanPrefix = prefix.replace(/^[Bb]y\s+/, "").trim();

  // Validate prefix length
  if (cleanPrefix.length === 0 || cleanPrefix.length > 45) {
    return { cleanedTitle: title };
  }

  // Check character set: letters, spaces, commas, hyphens, apostrophes
  if (!/^[a-zA-Z\s,\-']+$/.test(cleanPrefix)) {
    return { cleanedTitle: title };
  }

  const words = cleanPrefix.split(/\s+/);
  // Authors listed in prefixes are short, typically 1 to 3 words
  if (words.length > 3) {
    return { cleanedTitle: title };
  }

  // Check blacklist (case-insensitive)
  const NON_AUTHOR_PREFIXES = new Set([
    "breaking", "update", "exclusive", "sources", "opinion", "analysis", 
    "photos", "video", "watch", "live", "recap", "schedule", "gallery", 
    "trade deadline", "jays", "raptors", "leafs", "tfc", "toronto", 
    "sportsnet", "espn", "blogto", "star", "rumor", "rumors", "preview", 
    "report", "reports", "qa", "q&a", "updates", "breaking news", "draft", 
    "mock draft", "history", "watch live", "highlights", "fast recap", 
    "notebook", "mailbag", "power rankings", "rankings"
  ]);

  if (NON_AUTHOR_PREFIXES.has(cleanPrefix.toLowerCase())) {
    return { cleanedTitle: title };
  }
  if (words.some(w => NON_AUTHOR_PREFIXES.has(w.toLowerCase()))) {
    return { cleanedTitle: title };
  }

  // Proper noun check: each word must start with an uppercase letter, or be a common name particle
  const allowedParticles = new Set(["de", "del", "du", "van", "von", "le", "la", "al", "da", "di"]);
  const allCapitalized = words.every(word => {
    if (word.length === 0) return false;
    const firstChar = word[0];
    const isUpper = firstChar === firstChar.toUpperCase() && /[A-Z]/.test(firstChar);
    return isUpper || allowedParticles.has(word.toLowerCase());
  });

  if (!allCapitalized) {
    return { cleanedTitle: title };
  }

  return {
    author: cleanPrefix,
    cleanedTitle: restOfTitle
  };
}

export const normalizeRssItem: NormalizeRssItem = ({ topic, source, item }) => {
  const rawTitle = requiredString(item.title, "Untitled article");
  const url = cleanOptionalString(item.link) ?? "";

  const preferredId = cleanOptionalString(item.guid) ?? cleanOptionalString(item.link);
  const id = preferredId ?? `${source.name}:${rawTitle}`;

  const publishedAt = cleanOptionalString(item.pubDate);
  const summary = cleanOptionalString(item.contentSnippet);

  const rawItem = (item.raw ?? item) as any;
  let author = undefined;
  if (typeof rawItem?.creator === 'string') {
    author = rawItem.creator;
  } else if (typeof rawItem?.author === 'string') {
    author = rawItem.author;
  } else if (typeof rawItem?.['dc:creator'] === 'string') {
    author = rawItem['dc:creator'];
  } else if (typeof rawItem?.sourceField === 'string') {
    author = rawItem.sourceField;
  } else if (rawItem?.sourceField && typeof rawItem.sourceField === 'object' && typeof rawItem.sourceField._ === 'string') {
    author = rawItem.sourceField._;
  }

  if (author) {
    author = author.replace(/\s+/g, ' ').trim();
    if (author.length === 0) {
      author = undefined;
    }
  }

  // Clear generic authors that are just the site name
  if (author) {
    const cleanSource = cleanSourceName(source.name).toLowerCase();
    const lowerAuthor = author.toLowerCase();
    const isGeneric = 
      lowerAuthor === cleanSource || 
      lowerAuthor.includes(cleanSource) || 
      cleanSource.includes(lowerAuthor);
    if (isGeneric) {
      author = undefined;
    }
  }

  // If no specific author is extracted from metadata, try parsing from the title
  let finalTitle = rawTitle;
  if (!author) {
    const parsed = parseAuthorFromTitle(rawTitle);
    if (parsed.author) {
      author = parsed.author;
      finalTitle = parsed.cleanedTitle;
    }
  } else {
    // Even if we have a metadata author, if the title starts with that author prefix, clean it off the title
    const parsed = parseAuthorFromTitle(rawTitle);
    if (parsed.author && parsed.author.toLowerCase() === author.toLowerCase()) {
      finalTitle = parsed.cleanedTitle;
    }
  }

  // Extract image URL from raw item
  let imageUrl: string | undefined = undefined;

  // 1. Check enclosure URL
  if (rawItem.enclosure && typeof rawItem.enclosure.url === "string") {
    const encType = rawItem.enclosure.type;
    if (!encType || encType.startsWith("image/")) {
      imageUrl = rawItem.enclosure.url;
    }
  }

  // 2. Check enclosures array
  if (!imageUrl && Array.isArray(rawItem.enclosures)) {
    for (const enc of rawItem.enclosures) {
      if (enc && typeof enc.url === "string") {
        const encType = enc.type;
        if (!encType || encType.startsWith("image/")) {
          imageUrl = enc.url;
          break;
        }
      }
    }
  }

  // 3. Check media:content or media:thumbnail
  if (!imageUrl) {
    const mediaContent = rawItem["media:content"] || rawItem.media?.content;
    if (mediaContent) {
      if (Array.isArray(mediaContent) && mediaContent[0]?.url) {
        imageUrl = mediaContent[0].url;
      } else if (typeof mediaContent === "object" && mediaContent.url) {
        imageUrl = mediaContent.url;
      } else if (typeof mediaContent === "string") {
        imageUrl = mediaContent;
      }
    }
  }
  if (!imageUrl) {
    const mediaThumbnail = rawItem["media:thumbnail"] || rawItem.media?.thumbnail;
    if (mediaThumbnail) {
      if (Array.isArray(mediaThumbnail) && mediaThumbnail[0]?.url) {
        imageUrl = mediaThumbnail[0].url;
      } else if (typeof mediaThumbnail === "object" && mediaThumbnail.url) {
        imageUrl = mediaThumbnail.url;
      } else if (typeof mediaThumbnail === "string") {
        imageUrl = mediaThumbnail;
      }
    }
  }

  // 4. Check raw HTML elements for <img> tags
  if (!imageUrl) {
    const htmlCandidates = [
      rawItem["content:encoded"],
      rawItem.content,
      rawItem.description,
      item.contentSnippet
    ];
    for (const candidate of htmlCandidates) {
      if (typeof candidate === "string" && candidate.includes("<img")) {
        const matches = candidate.matchAll(/<img\s+[^>]*src=["']([^"']+)["']/gi);
        for (const match of matches) {
          if (match && match[1]) {
            const src = match[1];
            if (src.startsWith("http") && !src.includes("1x1") && !src.includes("pixel")) {
              imageUrl = src;
              break;
            }
          }
        }
        if (imageUrl) {
          break;
        }
      }
    }
  }

  if (imageUrl) {
    imageUrl = unescapeHtml(imageUrl);
    // Support any Nation Network domain (e.g., publish.bluejaysnation.com -> bluejaysnation.com)
    const match = imageUrl.match(/^https?:\/\/(publish\.([a-z0-9\-]+\.(?:com|ca)))\//i);
    if (match) {
      const publicHost = match[2];
      imageUrl = `https://${publicHost}/_next/image?url=${encodeURIComponent(imageUrl)}&w=1200&q=75`;
    }
  }

  const raw = item.raw ?? item;

  return {
    id,
    type: "news.article",
    topic,
    title: finalTitle,
    url,
    sourceName: source.name,
    publishedAt,
    summary,
    author,
    imageUrl: imageUrl || undefined,
    raw
  };
};
