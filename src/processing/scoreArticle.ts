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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAny(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  return terms.some((term) => {
    const escaped = escapeRegex(term);
    const regex = new RegExp(`\\b${escaped}(?:s|es)?\\b`, "i");
    return regex.test(text);
  });
}

export function scoreArticle(input: ScoreArticleInput): ScoreArticleResult {
  const { event, keywords, blockedTerms, trustedSource } = input;
  let score = 0;
  const reasons: string[] = [];

  // 1. Keyword match in title
  if (matchesAny(event.title, keywords)) {
    score += 20;
    reasons.push("Title matched keyword (+20)");
  }

  // 2. Keyword match in summary/content
  if (event.summary && matchesAny(event.summary, keywords)) {
    score += 10;
    reasons.push("Summary matched keyword (+10)");
  }

  // 3. Trusted source bonus
  if (trustedSource) {
    score += 15;
    reasons.push("Trusted source bonus (+15)");
  }

  // 4. Blocked term penalty
  const hasBlocked = matchesAny(event.title, blockedTerms) || 
                     (event.summary ? matchesAny(event.summary, blockedTerms) : false);
  if (hasBlocked) {
    score -= 20;
    reasons.push("Blocked term matched (-20)");
  }

  // 5. Missing URL penalty
  if (!event.url || event.url.trim() === "") {
    score -= 10;
    reasons.push("Missing URL (-10)");
  }

  return { score, reasons };
}

