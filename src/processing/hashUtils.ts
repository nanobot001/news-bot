import { createHash } from "node:crypto";

/**
 * Standard SHA-256 hasher
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Normalizes a URL by stripping protocols, www, tracking/unnecessary query parameters,
 * and trailing slashes. Standardizes YouTube URLs to a single canonical format.
 */
export function normalizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.substring(4);
    }

    // Canonicalize YouTube URLs
    if (host === "youtu.be" || host.includes("youtube.com")) {
      let videoId: string | null = null;
      if (host === "youtu.be") {
        const parts = parsed.pathname.split("/").filter(Boolean);
        videoId = parts[0] || null;
      } else {
        if (parsed.pathname.startsWith("/watch")) {
          videoId = parsed.searchParams.get("v");
        } else if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/v/") || parsed.pathname.startsWith("/shorts/")) {
          const parts = parsed.pathname.split("/").filter(Boolean);
          videoId = parts[1] || null;
        }
      }
      if (videoId) {
        // YouTube video IDs are case-sensitive, so preserve case for videoId
        return `youtube.com/watch?v=${videoId}`;
      }
    }

    let pathname = parsed.pathname;
    if (pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // Filter tracking parameters
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "utm_cid", "utm_reader", "feature", "ref", "gclid", "fbclid", "origin"
    ];
    
    const params = new URLSearchParams(parsed.search);
    for (const param of trackingParams) {
      params.delete(param);
    }

    const searchStr = params.toString();
    const search = searchStr ? `?${searchStr}` : "";

    return `${host}${pathname}${search}`;
  } catch {
    // Fallback if URL is malformed
    return urlStr.trim().toLowerCase();
  }
}

/**
 * Normalizes a title by lowercasing, stripping special characters/punctuation/emojis,
 * and collapsing spaces.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Keep only alphanumeric characters and spaces
    .replace(/\s+/g, " ")        // Collapse multiple spaces to one
    .trim();
}
