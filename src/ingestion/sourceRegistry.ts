export type SourceConfig = {
  name: string;
  url: string;
  trusted: boolean;
};

export type SourcesByTopic = Record<string, SourceConfig[]>;
