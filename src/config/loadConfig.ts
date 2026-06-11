import { readFile, writeFile, rename } from "node:fs/promises";

export const CONTENT_INTENTS = [
  "news",
  "official",
  "review",
  "guide",
  "opinion",
  "discussion",
  "reaction",
  "aggregate",
  "mixed",
] as const;

export type ContentIntent = typeof CONTENT_INTENTS[number];

export const CONTENT_ROUTES = [
  "immediate_post",
  "thread_only",
  "digest_pending",
  "review_pending",
  "skip",
] as const;

export type ContentRoute = typeof CONTENT_ROUTES[number];

export type IntentRoutingPolicy = {
  route: ContentRoute;
  postThreshold?: number;
  digestEligible?: boolean;
  digestSchedule?: string;
};

export type TopicConfig = {
  channelId: string;
  keywords: string[];
  locationKeywords?: string[];
  blockedTerms: string[];
  postThreshold: number;
  emoji?: string;
  disabled?: boolean;
  intentRouting?: Partial<Record<ContentIntent, IntentRoutingPolicy>>;
};

export type SourceConfig = {
  name: string;
  url: string;
  trusted: boolean;
  intentDefault?: ContentIntent;
  tier?: number;
  routeHint?: ContentRoute;
};

export type AppConfig = {
  topics: Record<string, TopicConfig>;
  sources: Record<string, SourceConfig[]>;
};

async function readJsonFile(path: string): Promise<unknown> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
    // Strip UTF-8 BOM if present
    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.substring(1);
    }
  } catch (error) {
    throw new Error(`Unable to read config file ${path}: ${formatError(error)}`);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Malformed JSON in config file ${path}: ${formatError(error)}`);
  }
}

async function writeJsonFileAtomic(path: string, data: unknown): Promise<void> {
  const tmpPath = path + ".tmp";
  const jsonString = JSON.stringify(data, null, 2);
  try {
    await writeFile(tmpPath, jsonString, "utf8");
    await rename(tmpPath, path);
  } catch (error) {
    throw new Error(`Failed to write config file atomic to ${path}: ${formatError(error)}`);
  }
}

function validateStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }

  return value.flatMap((item: string) =>
    item.split(",").map((part) => part.trim()).filter((part) => part.length > 0)
  );
}

function isContentIntent(value: unknown): value is ContentIntent {
  return typeof value === "string" && (CONTENT_INTENTS as readonly string[]).includes(value);
}

function isContentRoute(value: unknown): value is ContentRoute {
  return typeof value === "string" && (CONTENT_ROUTES as readonly string[]).includes(value);
}

function validateIntentRouting(value: unknown, label: string): Partial<Record<ContentIntent, IntentRoutingPolicy>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object keyed by content intent`);
  }

  const policies: Partial<Record<ContentIntent, IntentRoutingPolicy>> = {};

  for (const [intent, policy] of Object.entries(value)) {
    if (!isContentIntent(intent)) {
      throw new Error(`${label}.${intent} must be a supported content intent`);
    }

    if (!isRecord(policy)) {
      throw new Error(`${label}.${intent} must be an object`);
    }

    if (!isContentRoute(policy.route)) {
      throw new Error(`${label}.${intent}.route must be a supported content route`);
    }

    if (policy.postThreshold !== undefined && typeof policy.postThreshold !== "number") {
      throw new Error(`${label}.${intent}.postThreshold must be a number`);
    }

    if (policy.digestEligible !== undefined && typeof policy.digestEligible !== "boolean") {
      throw new Error(`${label}.${intent}.digestEligible must be a boolean`);
    }

    if (policy.digestSchedule !== undefined && typeof policy.digestSchedule !== "string") {
      throw new Error(`${label}.${intent}.digestSchedule must be a string`);
    }

    policies[intent] = {
      route: policy.route,
      postThreshold: policy.postThreshold as number | undefined,
      digestEligible: policy.digestEligible as boolean | undefined,
      digestSchedule: policy.digestSchedule as string | undefined,
    };
  }

  return policies;
}

function validateTopics(value: unknown): Record<string, TopicConfig> {
  if (!isRecord(value)) {
    throw new Error("topics config must be an object keyed by topic name");
  }

  const topics: Record<string, TopicConfig> = {};

  for (const [topicName, topic] of Object.entries(value)) {
    if (!isRecord(topic)) {
      throw new Error(`topics.${topicName} must be an object`);
    }

    if (typeof topic.channelId !== "string" || topic.channelId.length === 0) {
      throw new Error(`topics.${topicName}.channelId must be a non-empty string`);
    }

    if (typeof topic.postThreshold !== "number") {
      throw new Error(`topics.${topicName}.postThreshold must be a number`);
    }

    if (topic.emoji !== undefined && typeof topic.emoji !== "string") {
      throw new Error(`topics.${topicName}.emoji must be a string`);
    }

    if (topic.disabled !== undefined && typeof topic.disabled !== "boolean") {
      throw new Error(`topics.${topicName}.disabled must be a boolean`);
    }

    topics[topicName] = {
      channelId: topic.channelId,
      keywords: validateStringArray(topic.keywords, `topics.${topicName}.keywords`),
      locationKeywords: topic.locationKeywords !== undefined ? validateStringArray(topic.locationKeywords, `topics.${topicName}.locationKeywords`) : undefined,
      blockedTerms: validateStringArray(topic.blockedTerms, `topics.${topicName}.blockedTerms`),
      postThreshold: topic.postThreshold,
      emoji: topic.emoji as string | undefined,
      disabled: topic.disabled as boolean | undefined,
      intentRouting: topic.intentRouting !== undefined
        ? validateIntentRouting(topic.intentRouting, `topics.${topicName}.intentRouting`)
        : undefined,
    };
  }

  return topics;
}

function validateSources(value: unknown, topics: Record<string, TopicConfig>): Record<string, SourceConfig[]> {
  if (!isRecord(value)) {
    throw new Error("sources config must be an object keyed by topic name");
  }

  const sources: Record<string, SourceConfig[]> = {};

  for (const [topicName, topicSources] of Object.entries(value)) {
    if (!topics[topicName]) {
      throw new Error(`sources.${topicName} does not match a configured topic`);
    }

    if (!Array.isArray(topicSources)) {
      throw new Error(`sources.${topicName} must be an array`);
    }

    sources[topicName] = topicSources.map((source, index) => {
      const label = `sources.${topicName}[${index}]`;

      if (!isRecord(source)) {
        throw new Error(`${label} must be an object`);
      }

      if (typeof source.name !== "string" || source.name.length === 0) {
        throw new Error(`${label}.name must be a non-empty string`);
      }

      if (typeof source.url !== "string" || source.url.length === 0) {
        throw new Error(`${label}.url must be a non-empty string`);
      }

      if (typeof source.trusted !== "boolean") {
        throw new Error(`${label}.trusted must be a boolean`);
      }

      if (source.intentDefault !== undefined && !isContentIntent(source.intentDefault)) {
        throw new Error(`${label}.intentDefault must be a supported content intent`);
      }

      if (source.tier !== undefined && typeof source.tier !== "number") {
        throw new Error(`${label}.tier must be a number`);
      }

      if (source.routeHint !== undefined && !isContentRoute(source.routeHint)) {
        throw new Error(`${label}.routeHint must be a supported content route`);
      }

      return {
        name: source.name,
        url: source.url,
        trusted: source.trusted,
        intentDefault: source.intentDefault as ContentIntent | undefined,
        tier: source.tier as number | undefined,
        routeHint: source.routeHint as ContentRoute | undefined,
      };
    });
  }

  return sources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadAppConfig(): Promise<AppConfig> {
  const topics = validateTopics(await readJsonFile("src/config/topics.json"));
  const sources = validateSources(await readJsonFile("src/config/sources.json"), topics);

  return { topics, sources };
}

export async function reloadAppConfig(config: AppConfig): Promise<void> {
  const newConfig = await loadAppConfig();

  // Clear existing keys in-place
  for (const key of Object.keys(config.topics)) {
    delete config.topics[key];
  }
  for (const key of Object.keys(config.sources)) {
    delete config.sources[key];
  }

  // Assign new reloaded values in-place
  Object.assign(config.topics, newConfig.topics);
  Object.assign(config.sources, newConfig.sources);
}

export async function saveTopicsConfig(topics: Record<string, TopicConfig>): Promise<void> {
  await writeJsonFileAtomic("src/config/topics.json", topics);
}

export async function saveSourcesConfig(sources: Record<string, SourceConfig[]>): Promise<void> {
  await writeJsonFileAtomic("src/config/sources.json", sources);
}


