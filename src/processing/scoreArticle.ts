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

function getMatchedTerms(text: string, terms: string[]): string[] {
  if (terms.length === 0) return [];
  return terms.filter((term) => {
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
  let matchedTitleKeywords = getMatchedTerms(event.title, keywords);
  let matchedSummaryKeywords = event.summary ? getMatchedTerms(event.summary, keywords) : [];

  // Refine highlight matches for team-specific topics
  const TEAM_SPORTS_TOPICS = ["jays", "raptors"];
  const HIGHLIGHT_KEYWORDS = ["highlight", "highlights"];
  if (TEAM_SPORTS_TOPICS.includes(event.topic)) {
    const matchedTitleHighlights = matchedTitleKeywords.filter((k) => HIGHLIGHT_KEYWORDS.includes(k.toLowerCase()));
    const matchedSummaryHighlights = matchedSummaryKeywords.filter((k) => HIGHLIGHT_KEYWORDS.includes(k.toLowerCase()));
    const hasHighlightMatch = matchedTitleHighlights.length > 0 || matchedSummaryHighlights.length > 0;

    if (hasHighlightMatch) {
      const matchedTitleTeamSpecific = matchedTitleKeywords.filter((k) => !HIGHLIGHT_KEYWORDS.includes(k.toLowerCase()));
      const matchedSummaryTeamSpecific = matchedSummaryKeywords.filter((k) => !HIGHLIGHT_KEYWORDS.includes(k.toLowerCase()));
      const hasTeamSpecificMatch = matchedTitleTeamSpecific.length > 0 || matchedSummaryTeamSpecific.length > 0;

      if (!hasTeamSpecificMatch) {
        // Ignore highlight keywords since there is no team specific context
        matchedTitleKeywords = matchedTitleTeamSpecific;
        matchedSummaryKeywords = matchedSummaryTeamSpecific;
        reasons.push("Highlight keyword(s) matched but ignored due to lack of team/player context");
      }
    }
  }

  const titleHasCoreKeyword = matchedTitleKeywords.length > 0;
  const summaryHasCoreKeyword = matchedSummaryKeywords.length > 0;
  const hasCoreKeyword = titleHasCoreKeyword || summaryHasCoreKeyword;

  // 1. Keyword match in title
  if (titleHasCoreKeyword) {
    score += 20;
    const joined = matchedTitleKeywords.map((k) => `"${k}"`).join(", ");
    reasons.push(`Title matched keyword ${joined} (+20)`);
  }

  // 2. Keyword match in summary/content
  if (summaryHasCoreKeyword) {
    score += 10;
    const joined = matchedSummaryKeywords.map((k) => `"${k}"`).join(", ");
    reasons.push(`Summary matched keyword ${joined} (+10)`);
  }

  // 3. Location keyword matches (only applied if we have core keywords)
  if (locationKeywords && locationKeywords.length > 0) {
    const matchedTitleLocations = getMatchedTerms(event.title, locationKeywords);
    const matchedSummaryLocations = event.summary ? getMatchedTerms(event.summary, locationKeywords) : [];
    const titleHasLocation = matchedTitleLocations.length > 0;
    const summaryHasLocation = matchedSummaryLocations.length > 0;

    if (titleHasLocation || summaryHasLocation) {
      if (hasCoreKeyword) {
        if (titleHasLocation) {
          score += 20;
          const joined = matchedTitleLocations.map((k) => `"${k}"`).join(", ");
          reasons.push(`Title matched location keyword ${joined} (+20)`);
        }
        if (summaryHasLocation) {
          score += 10;
          const joined = matchedSummaryLocations.map((k) => `"${k}"`).join(", ");
          reasons.push(`Summary matched location keyword ${joined} (+10)`);
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
  const matchedTitleBlocked = getMatchedTerms(event.title, blockedTerms);
  const matchedSummaryBlocked = event.summary ? getMatchedTerms(event.summary, blockedTerms) : [];
  const allBlocked = [...matchedTitleBlocked, ...matchedSummaryBlocked];
  const uniqueBlocked = Array.from(new Set(allBlocked));
  if (uniqueBlocked.length > 0) {
    score -= 100;
    const joined = uniqueBlocked.map((k) => `"${k}"`).join(", ");
    reasons.push(`Blocked term matched ${joined} (-100)`);
  }

  // 6. Missing URL penalty
  if (!event.url || event.url.trim() === "") {
    score -= 10;
    reasons.push("Missing URL (-10)");
  }

  return { score, reasons };
}

