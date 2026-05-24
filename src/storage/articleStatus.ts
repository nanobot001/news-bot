export const ARTICLE_STATUSES = {
  INDEXED: "INDEXED",
  POSTED: "POSTED",
  SKIPPED_OLD: "SKIPPED_OLD",
  SKIPPED_LOW_SCORE: "SKIPPED_LOW_SCORE",
  SKIPPED_FILTERED: "SKIPPED_FILTERED",
} as const;

export type ArticleStatus = typeof ARTICLE_STATUSES[keyof typeof ARTICLE_STATUSES];

export function formatArticleStatus(status: string | null, postedAt: Date | null, reason: string | null): string {
  const effectiveStatus = postedAt ? ARTICLE_STATUSES.POSTED : status;

  switch (effectiveStatus) {
    case ARTICLE_STATUSES.POSTED:
      return "Posted";
    case ARTICLE_STATUSES.SKIPPED_OLD:
      return reason ? `Skipped: too old (${reason})` : "Skipped: too old";
    case ARTICLE_STATUSES.SKIPPED_LOW_SCORE:
      return reason ? `Skipped: low score (${reason})` : "Skipped: low score";
    case ARTICLE_STATUSES.SKIPPED_FILTERED:
      return reason ? `Skipped: filtered (${reason})` : "Skipped: filtered";
    case ARTICLE_STATUSES.INDEXED:
      return reason ? `Indexed (${reason})` : "Indexed";
    default:
      return reason ? `${effectiveStatus} (${reason})` : String(effectiveStatus);
  }
}
