export type FilterArticleInput = {
  score: number;
  threshold: number;
  isDuplicate: boolean;
  publishedAt?: string | Date | null;
  maxAgeHours?: number;
};

export type FilterArticleResult = {
  shouldPost: boolean;
  reasons: string[];
};

export function filterArticle(input: FilterArticleInput): FilterArticleResult {
  const { score, threshold, isDuplicate, publishedAt, maxAgeHours } = input;
  const reasons: string[] = [];

  if (isDuplicate) {
    reasons.push("Duplicate article");
    return { shouldPost: false, reasons };
  }

  if (publishedAt && maxAgeHours && maxAgeHours > 0) {
    const pubDate = typeof publishedAt === "string" ? new Date(publishedAt) : publishedAt;
    if (!isNaN(pubDate.getTime())) {
      const ageHours = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
      if (ageHours > maxAgeHours) {
        reasons.push(`Article age of ${ageHours.toFixed(1)} hours exceeds max age of ${maxAgeHours} hours`);
        return { shouldPost: false, reasons };
      }
    }
  }

  if (score < threshold) {
    reasons.push(`Score ${score} is below threshold of ${threshold}`);
    return { shouldPost: false, reasons };
  }

  reasons.push(`Score ${score} meets or exceeds threshold of ${threshold}`);
  return { shouldPost: true, reasons };
}


