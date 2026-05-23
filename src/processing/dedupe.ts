export type DedupeInput = {
  id?: string;
  url?: string;
  title?: string;
};

export type DedupeResult = {
  isDuplicate: boolean;
  reason?: "guid" | "urlHash" | "titleHash";
};
