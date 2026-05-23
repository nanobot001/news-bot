export type NormalizedEvent = {
  id: string;
  type: "news.article";
  topic: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt?: string;
  summary?: string;
  raw?: unknown;
};
