import type { Article } from "@prisma/client";
import type { ContentIntent, ContentRoute, SourceConfig, TopicConfig } from "../config/loadConfig.js";
import type { ContentRoutingResult } from "./contentRouting.js";

export type PostingPolicy = {
  cooldownMinutes?: number;
  maxImmediatePerHour?: number;
  maxImmediatePerDay?: number;
};

export type TopicPostingControls = PostingPolicy & {
  digestFirstIntents?: ContentIntent[];
  intentCaps?: Partial<Record<ContentIntent, PostingPolicy>>;
};

export type SourcePostingControls = PostingPolicy;

export type PostingControlBudget = {
  topicHourCount: number;
  topicDayCount: number;
  sourceHourCounts: Record<string, number>;
  sourceDayCounts: Record<string, number>;
  intentHourCounts: Partial<Record<ContentIntent, number>>;
  intentDayCounts: Partial<Record<ContentIntent, number>>;
  topicLastPostedAt?: Date;
  sourceLastPostedAt: Partial<Record<string, Date>>;
  intentLastPostedAt: Partial<Record<ContentIntent, Date>>;
};

export type PostingControlDecision = {
  route: ContentRoute;
  status: "DIGEST_PENDING" | "REVIEW_PENDING" | "SKIPPED_INTENT" | "POSTED";
  reason: string;
  reasons: string[];
  priority: number;
  throttleLabel?: string;
  isHighSignal: boolean;
};

const HIGH_SIGNAL_PATTERNS = [
  /\bopening(s)?\b/i,
  /\bopen(s|ed)?\b/i,
  /\bclosing(s)?\b/i,
  /\bclose(s|d)?\b/i,
  /\bmichelin\b/i,
  /\baward(s)?\b/i,
  /\baward-winning\b/i,
  /\bbreaking\b/i,
  /\bofficial\b/i,
  /\bannouncement(s)?\b/i,
  /\bannounces?\b/i,
  /\brecall\b/i,
  /\breopens?\b/i,
  /\bgrand opening\b/i,
  /\bnew location\b/i,
  /\bshut(ting)? down\b/i,
  /\bshuts?\b/i,
  /\bchef\b/i,
  /\bmenu\b/i,
  /\binspections?\b/i,
  /\bhealth inspection\b/i,
  /\bnewsworthy\b/i,
];

const DIGEST_FIRST_FALLBACK_INTENTS: ContentIntent[] = [
  "discussion",
  "aggregate",
  "review",
  "guide",
  "opinion",
  "reaction",
];

function hasHighSignalCue(title: string, summary?: string): boolean {
  const text = `${title}\n${summary ?? ""}`;
  return HIGH_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function sourcePriorityBonus(source: SourceConfig): number {
  let bonus = 0;
  if (source.trusted) bonus += 15;
  if (typeof source.tier === "number") {
    bonus += Math.max(0, 8 - Math.min(source.tier, 8));
  }
  if (source.routeHint === "immediate_post") bonus += 2;
  if (source.routeHint === "digest_pending") bonus -= 2;
  return bonus;
}

function intentPriorityBonus(intent: ContentIntent): number {
  switch (intent) {
    case "news":
    case "official":
      return 12;
    case "review":
    case "guide":
      return 5;
    case "mixed":
      return 2;
    case "discussion":
    case "aggregate":
    case "reaction":
    case "opinion":
    default:
      return 0;
  }
}

function recencyBonus(publishedAt?: string): number {
  if (!publishedAt) return 0;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours <= 1) return 10;
  if (ageHours <= 3) return 7;
  if (ageHours <= 6) return 4;
  if (ageHours <= 12) return 2;
  return 0;
}

function isHighSignalImmediateCandidate(input: {
  topic: string;
  source: SourceConfig;
  title: string;
  summary?: string;
  routingResult: ContentRoutingResult;
}): boolean {
  const { topic, source, title, summary, routingResult } = input;
  const hasCue = hasHighSignalCue(title, summary);

  if (topic === "toronto-eats") {
    if (hasCue) return true;
    if (source.trusted && (routingResult.intent === "news" || routingResult.intent === "official")) return true;
    return false;
  }

  if (routingResult.intent === "news" || routingResult.intent === "official") {
    return hasCue || source.trusted || typeof source.tier === "number";
  }

  return hasCue && source.trusted;
}

export function calculatePostingPriority(input: {
  score: number;
  source: SourceConfig;
  routingResult: ContentRoutingResult;
  title: string;
  summary?: string;
  publishedAt?: string;
  topic: string;
}): number {
  const { score, source, routingResult, title, summary, publishedAt, topic } = input;
  let priority = score;
  priority += sourcePriorityBonus(source);
  priority += intentPriorityBonus(routingResult.intent);
  priority += recencyBonus(publishedAt);

  if (hasHighSignalCue(title, summary)) {
    priority += topic === "toronto-eats" ? 25 : 18;
  }

  if (topic === "toronto-eats") {
    priority += source.trusted ? 4 : 0;
    if (routingResult.intent === "news" || routingResult.intent === "official") {
      priority += 3;
    }
  }

  return priority;
}

export function buildPostingControlBudget(articles: Article[], now = new Date()): PostingControlBudget {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const budget: PostingControlBudget = {
    topicHourCount: 0,
    topicDayCount: 0,
    sourceHourCounts: {},
    sourceDayCounts: {},
    intentHourCounts: {},
    intentDayCounts: {},
    sourceLastPostedAt: {},
    intentLastPostedAt: {},
  };

  for (const article of articles) {
    if (article.status !== "POSTED" || !article.postedAt) {
      continue;
    }

    if (article.postedAt >= dayAgo) {
      budget.topicDayCount += 1;
      budget.sourceDayCounts[article.source] = (budget.sourceDayCounts[article.source] ?? 0) + 1;
      if (article.intent) {
        const intent = article.intent as ContentIntent;
        budget.intentDayCounts[intent] = (budget.intentDayCounts[intent] ?? 0) + 1;
      }
      budget.topicLastPostedAt = !budget.topicLastPostedAt || budget.topicLastPostedAt < article.postedAt
        ? article.postedAt
        : budget.topicLastPostedAt;
      budget.sourceLastPostedAt[article.source] = !budget.sourceLastPostedAt[article.source] || budget.sourceLastPostedAt[article.source]! < article.postedAt
        ? article.postedAt
        : budget.sourceLastPostedAt[article.source];
      if (article.intent) {
        const intent = article.intent as ContentIntent;
        budget.intentLastPostedAt[intent] = !budget.intentLastPostedAt[intent] || budget.intentLastPostedAt[intent]! < article.postedAt
          ? article.postedAt
          : budget.intentLastPostedAt[intent];
      }
    }

    if (article.postedAt >= hourAgo) {
      budget.topicHourCount += 1;
      budget.sourceHourCounts[article.source] = (budget.sourceHourCounts[article.source] ?? 0) + 1;
      if (article.intent) {
        const intent = article.intent as ContentIntent;
        budget.intentHourCounts[intent] = (budget.intentHourCounts[intent] ?? 0) + 1;
      }
    }
  }

  return budget;
}

export function reserveImmediatePostingSlot(
  budget: PostingControlBudget,
  source: SourceConfig,
  intent: ContentIntent,
  timestamp: Date = new Date()
): void {
  budget.topicHourCount += 1;
  budget.topicDayCount += 1;
  budget.sourceHourCounts[source.name] = (budget.sourceHourCounts[source.name] ?? 0) + 1;
  budget.sourceDayCounts[source.name] = (budget.sourceDayCounts[source.name] ?? 0) + 1;
  budget.intentHourCounts[intent] = (budget.intentHourCounts[intent] ?? 0) + 1;
  budget.intentDayCounts[intent] = (budget.intentDayCounts[intent] ?? 0) + 1;
  budget.topicLastPostedAt = timestamp;
  budget.sourceLastPostedAt[source.name] = timestamp;
  budget.intentLastPostedAt[intent] = timestamp;
}

function getEffectivePolicy(
  topicConfig: TopicConfig,
  source: SourceConfig,
  intent: ContentIntent
): {
  topic?: PostingPolicy;
  source?: PostingPolicy;
  intent?: PostingPolicy;
  digestFirst: boolean;
} {
  const topic = topicConfig.postingControls;
  const sourcePolicy = source.postingControls;
  const intentPolicy = topic?.intentCaps?.[intent];
  const digestFirst = Boolean(topic?.digestFirstIntents?.includes(intent) || DIGEST_FIRST_FALLBACK_INTENTS.includes(intent));

  return {
    topic,
    source: sourcePolicy,
    intent: intentPolicy,
    digestFirst,
  };
}

function withinCooldown(lastPostedAt: Date | undefined, cooldownMinutes: number | undefined, now: Date): boolean {
  if (!lastPostedAt || cooldownMinutes === undefined || cooldownMinutes < 0) {
    return true;
  }

  const elapsedMs = now.getTime() - lastPostedAt.getTime();
  return elapsedMs >= cooldownMinutes * 60 * 1000;
}

function minPositive(...values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (filtered.length === 0) return undefined;
  return filtered.reduce((acc, value) => Math.min(acc, value));
}

function maxPositive(...values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (filtered.length === 0) return undefined;
  return filtered.reduce((acc, value) => Math.max(acc, value));
}

function maxPositiveDate(...values: Array<Date | undefined>): Date | undefined {
  const filtered = values.filter((value): value is Date => value instanceof Date);
  if (filtered.length === 0) return undefined;
  return filtered.reduce((acc, value) => (acc.getTime() >= value.getTime() ? acc : value));
}

export function evaluatePostingControls(input: {
  topic: string;
  source: SourceConfig;
  topicConfig: TopicConfig;
  routingResult: ContentRoutingResult;
  score: number;
  title: string;
  summary?: string;
  publishedAt?: string;
  budget: PostingControlBudget;
  now?: Date;
}): PostingControlDecision {
  const now = input.now ?? new Date();
  const { topic, source, topicConfig, routingResult, score, title, summary, publishedAt, budget } = input;
  const policy = getEffectivePolicy(topicConfig, source, routingResult.intent);
  const reasons: string[] = [...routingResult.reasons];
  const priority = calculatePostingPriority({ score, source, routingResult, title, summary, publishedAt, topic });
  const highSignal = isHighSignalImmediateCandidate({ topic, source, title, summary, routingResult });

  if (routingResult.route === "skip") {
    return {
      route: "skip",
      status: "SKIPPED_INTENT",
      reason: routingResult.reason,
      reasons,
      priority,
      isHighSignal: highSignal,
    };
  }

  if (routingResult.route === "review_pending") {
    return {
      route: "review_pending",
      status: "REVIEW_PENDING",
      reason: routingResult.reason,
      reasons,
      priority,
      isHighSignal: highSignal,
    };
  }

  if (policy.digestFirst && !highSignal) {
    const reason = `Digest-first policy selected for intent ${routingResult.intent}`;
    reasons.push(reason);
    return {
      route: "digest_pending",
      status: "DIGEST_PENDING",
      reason,
      reasons,
      priority,
      throttleLabel: "digest-first",
      isHighSignal: highSignal,
    };
  }

  const cooldownMinutes = maxPositive(policy.topic?.cooldownMinutes, policy.source?.cooldownMinutes, policy.intent?.cooldownMinutes);
  const maxPerHour = minPositive(policy.topic?.maxImmediatePerHour, policy.source?.maxImmediatePerHour, policy.intent?.maxImmediatePerHour);
  const maxPerDay = minPositive(policy.topic?.maxImmediatePerDay, policy.source?.maxImmediatePerDay, policy.intent?.maxImmediatePerDay);

  const cooldownLastAt = maxPositiveDate(
    budget.topicLastPostedAt,
    budget.sourceLastPostedAt[source.name],
    budget.intentLastPostedAt[routingResult.intent]
  );

  if (!withinCooldown(cooldownLastAt, cooldownMinutes, now)) {
    const reason = `Cooldown active for ${cooldownMinutes} minutes`;
    reasons.push(reason);
    return {
      route: "digest_pending",
      status: "DIGEST_PENDING",
      reason,
      reasons,
      priority,
      throttleLabel: "cooldown",
      isHighSignal: highSignal,
    };
  }

  const hourCount = Math.max(
    budget.topicHourCount,
    budget.sourceHourCounts[source.name] ?? 0,
    budget.intentHourCounts[routingResult.intent] ?? 0
  );
  const dayCount = Math.max(
    budget.topicDayCount,
    budget.sourceDayCounts[source.name] ?? 0,
    budget.intentDayCounts[routingResult.intent] ?? 0
  );

  if (maxPerHour !== undefined && hourCount >= maxPerHour) {
    const reason = `Hourly cap reached (${hourCount}/${maxPerHour})`;
    reasons.push(reason);
    return {
      route: "digest_pending",
      status: "DIGEST_PENDING",
      reason,
      reasons,
      priority,
      throttleLabel: "hourly cap",
      isHighSignal: highSignal,
    };
  }

  if (maxPerDay !== undefined && dayCount >= maxPerDay) {
    const reason = `Daily cap reached (${dayCount}/${maxPerDay})`;
    reasons.push(reason);
    return {
      route: "digest_pending",
      status: "DIGEST_PENDING",
      reason,
      reasons,
      priority,
      throttleLabel: "daily cap",
      isHighSignal: highSignal,
    };
  }

  const finalRoute = routingResult.route === "thread_only" ? "thread_only" : "immediate_post";
  const finalReason = highSignal
    ? "High-signal item kept immediate despite digest pressure"
    : "Immediate slot available after posting controls";

  reasons.push(finalReason);

  return {
    route: finalRoute,
    status: "POSTED",
    reason: finalReason,
    reasons,
    priority,
    isHighSignal: highSignal,
  };
}

export function formatPostingControlsSummary(topicConfig: TopicConfig): string {
  const controls = topicConfig.postingControls;
  if (!controls) {
    return "*No posting controls configured*";
  }

  const parts: string[] = [];
  if (controls.cooldownMinutes !== undefined) parts.push(`cooldown: \`${controls.cooldownMinutes}m\``);
  if (controls.maxImmediatePerHour !== undefined) parts.push(`hourly: \`${controls.maxImmediatePerHour}\``);
  if (controls.maxImmediatePerDay !== undefined) parts.push(`daily: \`${controls.maxImmediatePerDay}\``);
  if (controls.digestFirstIntents && controls.digestFirstIntents.length > 0) {
    parts.push(`digest-first: ${controls.digestFirstIntents.map((intent) => `\`${intent}\``).join(", ")}`);
  }

  return parts.length > 0 ? parts.join(", ") : "*No posting controls configured*";
}
