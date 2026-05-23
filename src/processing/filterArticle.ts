export type FilterArticleInput = {
  score: number;
  threshold: number;
  isDuplicate: boolean;
};

export type FilterArticleResult = {
  shouldPost: boolean;
  reasons: string[];
};
