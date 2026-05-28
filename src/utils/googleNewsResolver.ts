/**
 * Google News URL Resolver
 * 
 * Decodes obfuscated news.google.com/rss/articles/... URLs to their canonical publisher URLs
 * using the batchexecute protocol with signature and timestamp parsed from the article page.
 */

async function getDecodingParams(gn_art_id: string, fullUrl: string) {
  const res = await fetch(fullUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36"
    },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch article page: ${res.statusText}`);
  }
  const html = await res.text();
  
  const sgMatch = html.match(/data-n-a-sg="([^"]+)"/);
  const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);
  
  if (!sgMatch || !tsMatch) {
    throw new Error("Could not find signature or timestamp in the Google News page.");
  }
  
  return {
    signature: sgMatch[1],
    timestamp: parseInt(tsMatch[1], 10),
    gn_art_id
  };
}

async function fetchDecodedBatchExecute(art: { gn_art_id: string; timestamp: number; signature: string }) {
  const reqData = [
    "Fbv4je",
    JSON.stringify([
      "garturlreq",
      [
        [
          "X",
          "X",
          ["X", "X"],
          null,
          null,
          1,
          1,
          "US:en",
          null,
          1,
          null,
          null,
          null,
          null,
          null,
          0,
          1
        ],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0
      ],
      art.gn_art_id,
      art.timestamp,
      art.signature
    ])
  ];

  const payload = "f.req=" + encodeURIComponent(JSON.stringify([[reqData]]));
  
  const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: payload,
    signal: AbortSignal.timeout(4000)
  });
  
  if (!response.ok) {
    throw new Error(`BatchExecute returned HTTP ${response.status}`);
  }
  
  const text = await response.text();
  const parts = text.split("\n\n");
  if (parts.length < 2) {
    throw new Error("Invalid BatchExecute response structure");
  }
  
  const outerJson = JSON.parse(parts[1]);
  const innerJsonStr = outerJson[0][2];
  if (!innerJsonStr) {
    throw new Error("No data returned inside the BatchExecute response");
  }
  
  const innerJson = JSON.parse(innerJsonStr);
  return innerJson[1];
}

export async function decodeGoogleNewsUrl(sourceUrl: string): Promise<string> {
  try {
    const url = new URL(sourceUrl);
    const path = url.pathname.split("/");
    if (
      url.hostname === "news.google.com" &&
      path.length > 1 &&
      path[path.length - 2] === "articles"
    ) {
      const base64 = path[path.length - 1];
      
      // Attempt offline decoding first for old style URLs
      let str = Buffer.from(base64, "base64").toString("binary");

      const prefix = Buffer.from([0x08, 0x13, 0x22]).toString("binary");
      if (str.startsWith(prefix)) {
        str = str.substring(prefix.length);
      }

      const suffix = Buffer.from([0xd2, 0x01, 0x00]).toString("binary");
      if (str.endsWith(suffix)) {
        str = str.substring(0, str.length - suffix.length);
      }

      // One or two bytes to skip
      const bytes = Uint8Array.from(str, c => c.charCodeAt(0));
      const len = bytes.at(0)!;
      if (len >= 0x80) {
        str = str.substring(2, len + 2);
      } else {
        str = str.substring(1, len + 1);
      }

      // If it has the new July 2024 encoding, decode via batch execute
      if (str.startsWith("AU_yqL")) {
        const params = await getDecodingParams(base64, sourceUrl);
        const resolved = await fetchDecodedBatchExecute(params);
        return resolved;
      }

      return str;
    }
  } catch (err) {
    console.warn(`[GoogleNewsResolver] Failed to decode ${sourceUrl}, returning original:`, err);
  }
  return sourceUrl;
}
