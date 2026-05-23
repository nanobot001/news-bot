import { createHash } from "node:crypto";

/**
 * Standard SHA-256 hasher
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Normalizes a URL by stripping protocols, www, query parameters, hashes, and trailing slashes.
 */
export function normalizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.substring(4);
    }
    let pathname = parsed.pathname;
    if (pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${host}${pathname}`;
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
