export const ARTICLE_STATUSES = {
  INDEXED: "INDEXED",
  POSTED: "POSTED",
  SKIPPED_OLD: "SKIPPED_OLD",
  SKIPPED_LOW_SCORE: "SKIPPED_LOW_SCORE",
  SKIPPED_FILTERED: "SKIPPED_FILTERED",
  REMOVED: "REMOVED",
  RELATED_COVERAGE: "RELATED_COVERAGE",
  STORY_UPDATE_REPLY: "STORY_UPDATE_REPLY",
  DIGEST_PENDING: "DIGEST_PENDING",
  REVIEW_PENDING: "REVIEW_PENDING",
  SKIPPED_INTENT: "SKIPPED_INTENT",
  POSTED_DIGEST: "POSTED_DIGEST",
} as const;

export type ArticleStatus = typeof ARTICLE_STATUSES[keyof typeof ARTICLE_STATUSES];

export function formatArticleStatus(status: string | null, postedAt: Date | null, reason: string | null): string {
  let effectiveStatus = status;
  if (
    status !== "REMOVED" &&
    status !== "RELATED_COVERAGE" &&
    status !== "STORY_UPDATE_REPLY" &&
    postedAt
  ) {
    effectiveStatus = ARTICLE_STATUSES.POSTED;
  }

  switch (effectiveStatus) {
    case ARTICLE_STATUSES.POSTED:
      return "Posted";
    case ARTICLE_STATUSES.RELATED_COVERAGE:
      return reason ? `Related Coverage (${reason})` : "Related Coverage";
    case ARTICLE_STATUSES.STORY_UPDATE_REPLY:
      return reason ? `Thread Reply (${reason})` : "Thread Reply";
    case ARTICLE_STATUSES.DIGEST_PENDING:
      return reason ? `Digest Pending (${reason})` : "Digest Pending";
    case ARTICLE_STATUSES.POSTED_DIGEST:
      return reason ? `Posted Digest (${reason})` : "Posted Digest";
    case ARTICLE_STATUSES.REVIEW_PENDING:
      return reason ? `Review Pending (${reason})` : "Review Pending";
    case ARTICLE_STATUSES.SKIPPED_INTENT:
      return reason ? `Skipped: intent routing (${reason})` : "Skipped: intent routing";
    case ARTICLE_STATUSES.SKIPPED_OLD:
      return reason ? `Skipped: too old (${reason})` : "Skipped: too old";
    case ARTICLE_STATUSES.SKIPPED_LOW_SCORE:
      return reason ? `Skipped: low score (${reason})` : "Skipped: low score";
    case ARTICLE_STATUSES.SKIPPED_FILTERED:
      return reason ? `Skipped: filtered (${reason})` : "Skipped: filtered";
    case ARTICLE_STATUSES.INDEXED:
      return reason ? `Indexed (${reason})` : "Indexed";
    case ARTICLE_STATUSES.REMOVED:
      return reason ? `Removed (${reason})` : "Removed";
    default:
      return reason ? `${effectiveStatus} (${reason})` : String(effectiveStatus);
  }
}

export function routeToPendingStatus(route: string, filterReasons: string[]): ArticleStatus {
  if (route === "digest_pending") {
    return ARTICLE_STATUSES.DIGEST_PENDING;
  }
  if (route === "review_pending") {
    return ARTICLE_STATUSES.REVIEW_PENDING;
  }
  if (route === "skip") {
    return ARTICLE_STATUSES.SKIPPED_INTENT;
  }
  return ARTICLE_STATUSES.INDEXED;
}

export function classifySkipStatus(reasons: string[]): ArticleStatus {
  const reasonStr = reasons.join("; ").toLowerCase();
  if (reasonStr.includes("too old")) {
    return ARTICLE_STATUSES.SKIPPED_OLD;
  }
  if (reasonStr.includes("score")) {
    return ARTICLE_STATUSES.SKIPPED_LOW_SCORE;
  }
  return ARTICLE_STATUSES.SKIPPED_FILTERED;
}
