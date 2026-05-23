import type { ParsedRssItem } from "../ingestion/parseRss.js";
import type { SourceConfig } from "../ingestion/sourceRegistry.js";
import type { NormalizedEvent } from "./normalizedEvent.js";

export type NormalizeRssInput = {
  topic: string;
  source: SourceConfig;
  item: ParsedRssItem;
};

export type NormalizeRssItem = (input: NormalizeRssInput) => NormalizedEvent;
