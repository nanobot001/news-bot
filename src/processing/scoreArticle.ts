import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export type ScoreArticleInput = {
  event: NormalizedEvent;
  keywords: string[];
  blockedTerms: string[];
  trustedSource: boolean;
};

export type ScoreArticleResult = {
  score: number;
  reasons: string[];
};
