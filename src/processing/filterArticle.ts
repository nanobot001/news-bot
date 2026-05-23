export type FilterArticleInput = {
  score: number;
  threshold: number;
  isDuplicate: boolean;
};

export type FilterArticleResult = {
  shouldPost: boolean;
  reasons: string[];
};

export function filterArticle(input: FilterArticleInput): FilterArticleResult {
  const { score, threshold, isDuplicate } = input;
  const reasons: string[] = [];

  if (isDuplicate) {
    reasons.push("Duplicate article");
    return { shouldPost: false, reasons };
  }

  if (score < threshold) {
    reasons.push(`Score ${score} is below threshold of ${threshold}`);
    return { shouldPost: false, reasons };
  }

  reasons.push(`Score ${score} meets or exceeds threshold of ${threshold}`);
  return { shouldPost: true, reasons };
}

