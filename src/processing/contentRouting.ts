import type {
  ContentIntent,
  ContentRoute,
  SourceConfig,
  TopicConfig,
} from "../config/loadConfig.js";
import type { NormalizedEvent } from "../normalization/normalizedEvent.js";

export type IntentClassification = {
  intent: ContentIntent;
  confidence: number;
  reasons: string[];
};

export type RoutingDecision = {
  route: ContentRoute;
  threshold: number;
  reason: string;
  reasons: string[];
};

export type ContentRoutingResult = IntentClassification & RoutingDecision;

const INTENT_RULES: Array<{
  intent: ContentIntent;
  confidence: number;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    intent: "opinion",
    confidence: 0.9,
    reason: "Title or summary contains opinion/editorial language",
    patterns: [/\bopinion\b/i, /\beditorial\b/i, /\bcolumn\b/i, /\bcommentary\b/i],
  },
  {
    intent: "reaction",
    confidence: 0.86,
    reason: "Title or summary frames public, fan, or community reaction",
    patterns: [/\breacts?\b/i, /\breaction\b/i, /\bbacklash\b/i, /\bfurious\b/i, /\bpeople are\b/i, /\bfans are\b/i],
  },
  {
    intent: "discussion",
    confidence: 0.84,
    reason: "Title or summary is phrased as a discussion prompt",
    patterns: [/\?$/, /\bwhat are your thoughts\b/i, /\banyone know\b/i, /\blooking for\b/i, /\bdiscussion\b/i, /\bmegathread\b/i],
  },
  {
    intent: "review",
    confidence: 0.82,
    reason: "Title or summary contains review/tasting/ranking language",
    patterns: [/\breview\b/i, /\breviews\b/i, /\btried\b/i, /\btaste test\b/i, /\branked\b/i, /\brating\b/i, /\bworth it\b/i],
  },
  {
    intent: "guide",
    confidence: 0.8,
    reason: "Title or summary contains guide/list/discovery language",
    patterns: [/\bbest\b/i, /\bguide\b/i, /\bwhere to\b/i, /\bthings to\b/i, /\bhidden gem\b/i, /\bmust try\b/i],
  },
  {
    intent: "news",
    confidence: 0.78,
    reason: "Title or summary contains timely news language",
    patterns: [
      /\bbreaking\b/i,
      /\bannounces?\b/i,
      /\bopens?\b/i,
      /\bcloses?\b/i,
      /\bclosing\b/i,
      /\blaunch(?:es|ed)?\b/i,
      /\brelease(?:s|d)?\b/i,
      /\brecall\b/i,
      /\bwarning\b/i,
      /\bapproved?\b/i,
      /\bacquires?\b/i,
      /\bcharged\b/i,
    ],
  },
];

export function classifyContentIntent(event: NormalizedEvent, source: SourceConfig): IntentClassification {
  const reasons: string[] = [];
  const text = `${event.title}\n${event.summary ?? ""}`;
  const inferredSourceIntent = inferSourceIntent(source);

  if (
    inferredSourceIntent &&
    source.intentDefault !== "mixed" &&
    (inferredSourceIntent.intent === "discussion" || inferredSourceIntent.intent === "aggregate")
  ) {
    return inferredSourceIntent;
  }

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      reasons.push(rule.reason);
      if (inferredSourceIntent && inferredSourceIntent.intent !== "mixed" && inferredSourceIntent.intent !== rule.intent) {
        reasons.push(`Source default suggested ${inferredSourceIntent.intent}, item-level rule overrode it`);
      }
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        reasons,
      };
    }
  }

  if (inferredSourceIntent) {
    reasons.push(...inferredSourceIntent.reasons);
    return {
      intent: inferredSourceIntent.intent,
      confidence: inferredSourceIntent.confidence,
      reasons,
    };
  }

  reasons.push("No intent-specific rule matched; preserving legacy immediate-news behavior");
  return {
    intent: "news",
    confidence: 0.5,
    reasons,
  };
}

export function decideContentRoute(input: {
  classification: IntentClassification;
  topicConfig: TopicConfig;
  source: SourceConfig;
  score: number;
  filterAllowsPost: boolean;
  filterReasons: string[];
}): RoutingDecision {
  const { classification, topicConfig, source, score, filterAllowsPost, filterReasons } = input;
  const policy = topicConfig.intentRouting?.[classification.intent];
  const threshold = policy?.postThreshold ?? topicConfig.postThreshold;
  const reasons = [...classification.reasons];

  if (!filterAllowsPost) {
    return {
      route: "skip",
      threshold,
      reason: filterReasons.join("; ") || `Score ${score} did not satisfy routing threshold`,
      reasons,
    };
  }

  if (source.routeHint) {
    reasons.push(`Source route hint selected ${source.routeHint}`);
    return {
      route: source.routeHint,
      threshold,
      reason: `Source route hint selected ${source.routeHint}`,
      reasons,
    };
  }

  if (policy) {
    reasons.push(`Topic intent policy selected ${policy.route} for ${classification.intent}`);
    return {
      route: policy.route,
      threshold,
      reason: `Topic intent policy selected ${policy.route} for ${classification.intent}`,
      reasons,
    };
  }

  if (classification.intent === "discussion") {
    reasons.push("Default discussion routing is thread-only before digest fallback");
    return {
      route: "thread_only",
      threshold,
      reason: "Discussion items are routed to related threads when possible",
      reasons,
    };
  }

  if (classification.intent === "aggregate") {
    reasons.push("Default aggregate routing is digest pending");
    return {
      route: "digest_pending",
      threshold,
      reason: "Aggregate feeds are routed to digest pending by default",
      reasons,
    };
  }

  return {
    route: "immediate_post",
    threshold,
    reason: "Legacy immediate posting behavior preserved",
    reasons,
  };
}

export function evaluateContentRouting(input: {
  event: NormalizedEvent;
  source: SourceConfig;
  topicConfig: TopicConfig;
  score: number;
  filterAllowsPost: boolean;
  filterReasons: string[];
}): ContentRoutingResult {
  const classification = classifyContentIntent(input.event, input.source);
  const decision = decideContentRoute({
    classification,
    topicConfig: input.topicConfig,
    source: input.source,
    score: input.score,
    filterAllowsPost: input.filterAllowsPost,
    filterReasons: input.filterReasons,
  });

  return {
    ...classification,
    ...decision,
  };
}

function inferSourceIntent(source: SourceConfig): IntentClassification | null {
  if (source.intentDefault) {
    return {
      intent: source.intentDefault,
      confidence: source.intentDefault === "mixed" ? 0.45 : 0.72,
      reasons: [`Source configured intent default ${source.intentDefault}`],
    };
  }

  const sourceText = `${source.name} ${source.url}`.toLowerCase();
  if (sourceText.includes("reddit.com") || sourceText.includes(" reddit ") || sourceText.includes("forum")) {
    return {
      intent: "discussion",
      confidence: 0.82,
      reasons: ["Reddit/forum-like source defaults to discussion"],
    };
  }

  if (source.url.toLowerCase().startsWith("https://news.google.com/rss/search")) {
    return {
      intent: "aggregate",
      confidence: 0.8,
      reasons: ["Google News search feed defaults to aggregate"],
    };
  }

  return null;
}
