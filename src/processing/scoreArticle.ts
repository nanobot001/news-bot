import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export type ScoreArticleInput = {
  event: NormalizedEvent;
  keywords: string[];
  locationKeywords?: string[];
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
  const { event, keywords, locationKeywords = [], blockedTerms, trustedSource } = input;
  let score = 0;
  const reasons: string[] = [];

  // Check core keywords
  const titleHasCoreKeyword = matchesAny(event.title, keywords);
  const summaryHasCoreKeyword = event.summary ? matchesAny(event.summary, keywords) : false;
  const hasCoreKeyword = titleHasCoreKeyword || summaryHasCoreKeyword;

  // 1. Keyword match in title
  if (titleHasCoreKeyword) {
    score += 20;
    reasons.push("Title matched keyword (+20)");
  }

  // 2. Keyword match in summary/content
  if (summaryHasCoreKeyword) {
    score += 10;
    reasons.push("Summary matched keyword (+10)");
  }

  // 3. Location keyword matches (only applied if we have core keywords or a trusted source)
  if (locationKeywords && locationKeywords.length > 0) {
    const titleHasLocation = matchesAny(event.title, locationKeywords);
    const summaryHasLocation = event.summary ? matchesAny(event.summary, locationKeywords) : false;

    if (titleHasLocation || summaryHasLocation) {
      if (hasCoreKeyword || trustedSource) {
        if (titleHasLocation) {
          score += 20;
          reasons.push("Title matched location keyword (+20)");
        }
        if (summaryHasLocation) {
          score += 10;
          reasons.push("Summary matched location keyword (+10)");
        }
      } else {
        reasons.push("Location matched but ignored due to lack of core topic context");
      }
    }
  }

  // 4. Trusted source bonus
  if (trustedSource) {
    score += 15;
    reasons.push("Trusted source bonus (+15)");
  }

  // 5. Blocked term penalty
  const hasBlocked = matchesAny(event.title, blockedTerms) || 
                     (event.summary ? matchesAny(event.summary, blockedTerms) : false);
  if (hasBlocked) {
    score -= 100;
    reasons.push("Blocked term matched (-100)");
  }

  // 6. Missing URL penalty
  if (!event.url || event.url.trim() === "") {
    score -= 10;
    reasons.push("Missing URL (-10)");
  }

  return { score, reasons };
}

