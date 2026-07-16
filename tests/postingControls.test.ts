import assert from "node:assert/strict";
import test from "node:test";
import type { ContentRoutingResult, SourceConfig, TopicConfig } from "../src/config/loadConfig.js";
import {
  evaluatePostingControls,
  type PostingControlBudget,
} from "../src/processing/postingControls.js";

const source: SourceConfig = {
  name: "Example Source",
  url: "https://example.com/rss",
  trusted: false,
};

const topic: TopicConfig = {
  channelId: "channel-1",
  keywords: [],
  blockedTerms: [],
  postThreshold: 10,
};

const budget = (): PostingControlBudget => ({
  topicHourCount: 0,
  topicDayCount: 0,
  sourceHourCounts: {},
  sourceDayCounts: {},
  intentHourCounts: {},
  intentDayCounts: {},
  sourceLastPostedAt: {},
  intentLastPostedAt: {},
});

function routing(overrides: Partial<ContentRoutingResult> = {}): ContentRoutingResult {
  return {
    intent: "news",
    confidence: 0.9,
    reasons: [],
    route: "immediate_post",
    threshold: 10,
    reason: "Immediate news",
    ...overrides,
  };
}

test("posting controls", async (t) => {
  await t.test("routes items to digest when the topic hourly cap is reached", () => {
    const configuredTopic = {
      ...topic,
      postingControls: { maxImmediatePerHour: 1 },
    };
    const currentBudget = budget();
    currentBudget.topicHourCount = 1;

    const decision = evaluatePostingControls({
      topic: "tech",
      source,
      topicConfig: configuredTopic,
      routingResult: routing(),
      score: 30,
      title: "New technology announcement",
      budget: currentBudget,
    });

    assert.equal(decision.status, "DIGEST_PENDING");
    assert.equal(decision.route, "digest_pending");
    assert.match(decision.reason, /Hourly cap reached/);
  });

  await t.test("uses digest-first routing for ordinary discussion items", () => {
    const decision = evaluatePostingControls({
      topic: "toronto-eats",
      source,
      topicConfig: topic,
      routingResult: routing({ intent: "discussion", route: "thread_only" }),
      score: 30,
      title: "Anyone know a good restaurant?",
      budget: budget(),
    });

    assert.equal(decision.status, "DIGEST_PENDING");
    assert.equal(decision.route, "digest_pending");
    assert.match(decision.reason, /Digest-first policy/);
  });

  await t.test("keeps a high-signal Toronto Eats announcement immediate", () => {
    const decision = evaluatePostingControls({
      topic: "toronto-eats",
      source: { ...source, trusted: true },
      topicConfig: topic,
      routingResult: routing({ intent: "news" }),
      score: 40,
      title: "New restaurant opening in Toronto",
      budget: budget(),
    });

    assert.equal(decision.status, "POSTED");
    assert.equal(decision.route, "immediate_post");
    assert.equal(decision.isHighSignal, true);
  });
});
