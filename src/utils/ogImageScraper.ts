/**
 * Canonical Page Image Scraper
 * 
 * Fetches the canonical page of an article and extracts the og:image or twitter:image metadata tags.
 */

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

export async function scrapeOgImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(4000) // 4 second timeout
    });
    if (!res.ok) {
      return undefined;
    }
    const html = await res.text();
    
    // Look for og:image
    const ogMatch = html.match(/<meta\s+[^>]*property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                    html.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (ogMatch) {
      return unescapeHtml(ogMatch[1]);
    }
    
    // Fallback to twitter:image
    const twitterMatch = html.match(/<meta\s+[^>]*name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+[^>]*content=["']([^"']+)["']\s+name=["']twitter:image["']/i);
    if (twitterMatch) {
      return unescapeHtml(twitterMatch[1]);
    }
    
    return undefined;
  } catch (err) {
    // Fail silently to not disrupt pipeline
    return undefined;
  }
}
