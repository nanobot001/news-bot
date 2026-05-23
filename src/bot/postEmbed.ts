import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export type ArticleEmbedInput = {
  event: NormalizedEvent;
  score: number;
};
