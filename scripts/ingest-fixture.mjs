import { readFile } from "node:fs/promises";

import { parseRssXml } from "../dist/ingestion/parseRss.js";
import { normalizeRssItem } from "../dist/normalization/normalizeRssItem.js";

async function main() {
  const xml = await readFile("fixtures/sample-feed.xml", "utf8");
  const items = await parseRssXml(xml);

  const topic = "fixture";
  const source = { name: "Fixture Feed", url: "fixtures/sample-feed.xml", trusted: true };
  const normalized = items.map((item) => normalizeRssItem({ topic, source, item }));

  if (normalized.length === 0) {
    throw new Error("Fixture feed parsed zero items.");
  }

  const withUrl = normalized.filter((event) => event.url.length > 0).length;
  const missingUrl = normalized.length - withUrl;

  console.log(`Fixture ingestion ok: parsed=${items.length}, normalized=${normalized.length}, missingUrl=${missingUrl}`);
  console.log(`Sample: ${normalized[0]?.id} | ${normalized[0]?.title}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fixture ingestion failed: ${message}`);
  process.exitCode = 1;
});

