import assert from "node:assert/strict";
import test from "node:test";
import { classifyContentIntent, decideContentRoute } from "../src/processing/contentRouting.js";
import type { SourceConfig, TopicConfig } from "../src/config/loadConfig.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

const baseTopic: TopicConfig = {
  channelId: "channel",
  keywords: ["restaurant"],
  blockedTerms: [],
  postThreshold: 20,
};

const baseEvent: NormalizedEvent = {
  id: "event-1",
  type: "news.article",
  topic: "toronto-eats",
  title: "Toronto restaurant announces new location",
  url: "https://example.com/story",
  sourceName: "Example",
};

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    name: "Example",
    url: "https://example.com/feed",
    trusted: false,
    ...overrides,
  };
}

test("content intent routing", async (t) => {
  await t.test("defaults Reddit and forum-like sources to discussion", () => {
    const result = classifyContentIntent(baseEvent, source({
      name: "Reddit FoodToronto",
      url: "https://www.reddit.com/r/FoodToronto/.rss",
    }));

    assert.equal(result.intent, "discussion");
    assert.ok(result.confidence >= 0.8);
    assert.match(result.reasons.join(" "), /Reddit\/forum-like source/);
  });

  await t.test("defaults Google News search feeds to aggregate", () => {
    const result = classifyContentIntent(baseEvent, source({
      name: "Google News - Restaurants",
      url: "https://news.google.com/rss/search?q=toronto+restaurant",
    }));

    assert.equal(result.intent, "aggregate");
    assert.ok(result.confidence >= 0.8);
    assert.match(result.reasons.join(" "), /Google News search feed/);
  });

  await t.test("item-level rules override mixed source defaults", () => {
    const result = classifyContentIntent({
      ...baseEvent,
      title: "The best new brunch spots in Toronto",
    }, source({ intentDefault: "mixed" }));

    assert.equal(result.intent, "guide");
    assert.match(result.reasons.join(" "), /guide\/list\/discovery/);
  });

  await t.test("discussion routes thread-only by default when score passes", () => {
    const classification = classifyContentIntent(baseEvent, source({
      name: "Reddit FoodToronto",
      url: "https://www.reddit.com/r/FoodToronto/.rss",
    }));

    const route = decideContentRoute({
      classification,
      topicConfig: baseTopic,
      source: source(),
      score: 25,
      filterAllowsPost: true,
      filterReasons: ["Score 25 meets or exceeds threshold of 20"],
    });

    assert.equal(route.route, "thread_only");
  });

  await t.test("aggregate routes digest pending by default when score passes", () => {
    const classification = classifyContentIntent(baseEvent, source({
      name: "Google News - Restaurants",
      url: "https://news.google.com/rss/search?q=toronto+restaurant",
    }));

    const route = decideContentRoute({
      classification,
      topicConfig: baseTopic,
      source: source(),
      score: 25,
      filterAllowsPost: true,
      filterReasons: ["Score 25 meets or exceeds threshold of 20"],
    });

    assert.equal(route.route, "digest_pending");
  });

  await t.test("topics without intent policies preserve immediate posting for ordinary news", () => {
    const classification = classifyContentIntent(baseEvent, source());

    const route = decideContentRoute({
      classification,
      topicConfig: baseTopic,
      source: source(),
      score: 25,
      filterAllowsPost: true,
      filterReasons: ["Score 25 meets or exceeds threshold of 20"],
    });

    assert.equal(route.route, "immediate_post");
  });

  await t.test("topic intent policies can override route and threshold", () => {
    const classification = classifyContentIntent({
      ...baseEvent,
      title: "Review: Toronto restaurant tasting menu",
    }, source());
    const topic: TopicConfig = {
      ...baseTopic,
      intentRouting: {
        review: {
          route: "review_pending",
          postThreshold: 10,
        },
      },
    };

    const route = decideContentRoute({
      classification,
      topicConfig: topic,
      source: source(),
      score: 15,
      filterAllowsPost: true,
      filterReasons: ["Score 15 meets or exceeds threshold of 10"],
    });

    assert.equal(route.route, "review_pending");
    assert.equal(route.threshold, 10);
  });
});
