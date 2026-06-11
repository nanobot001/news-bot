import type { ContentIntent, ContentRoute } from "../config/loadConfig.js";

export type SourceConfig = {
  name: string;
  url: string;
  trusted: boolean;
  intentDefault?: ContentIntent;
  tier?: number;
  routeHint?: ContentRoute;
};

export type SourcesByTopic = Record<string, SourceConfig[]>;

export function getSourcesForTopic(sourcesByTopic: SourcesByTopic, topic: string): SourceConfig[] {
  const sources = sourcesByTopic[topic];

  if (!sources) {
    throw new Error(`No sources configured for topic '${topic}'.`);
  }

  return sources;
}
