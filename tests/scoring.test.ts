import assert from "node:assert/strict";
import test from "node:test";
import { scoreArticle } from "../src/processing/scoreArticle.js";
import { filterArticle } from "../src/processing/filterArticle.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";

test("Scoring and Filtering Logic Suite", async (t) => {
  const dummyEvent: NormalizedEvent = {
    id: "test-id",
    type: "news.article",
    topic: "anime",
    title: "Normal Title",
    url: "https://example.com/anime/1",
    sourceName: "Anime Feed",
    summary: "Standard news summary.",
  };

  await t.test("should apply flat keyword bonus to title (Option A - binary)", () => {
    const event = { ...dummyEvent, title: "New Anime Trailer!" };
    const result = scoreArticle({
      event,
      keywords: ["anime", "trailer"],
      blockedTerms: [],
      trustedSource: false,
    });

    // Score: 0 + 20 (title match) = 20
    assert.equal(result.score, 20);
    assert.ok(result.reasons.some((r) => r.includes("Title matched keyword")));
  });

  await t.test("should apply flat keyword bonus to summary", () => {
    const event = { ...dummyEvent, summary: "This is an adaptation." };
    const result = scoreArticle({
      event,
      keywords: ["adaptation"],
      blockedTerms: [],
      trustedSource: false,
    });

    // Score: 0 + 10 (summary match) = 10
    assert.equal(result.score, 10);
    assert.ok(result.reasons.some((r) => r.includes("Summary matched keyword")));
  });

  await t.test("should apply trusted source bonus", () => {
    const result = scoreArticle({
      event: dummyEvent,
      keywords: [],
      blockedTerms: [],
      trustedSource: true,
    });

    // Score: 0 + 15 (trusted source) = 15
    assert.equal(result.score, 15);
    assert.ok(result.reasons.some((r) => r.includes("Trusted source bonus")));
  });

  await t.test("should apply blocked term penalty", () => {
    const event = { ...dummyEvent, title: "Sponsored Content: New Anime" };
    const result = scoreArticle({
      event,
      keywords: ["anime"],
      blockedTerms: ["sponsored"],
      trustedSource: false,
    });

    // Score: 0 + 20 (title keyword) - 20 (blocked term) = 0
    assert.equal(result.score, 0);
    assert.ok(result.reasons.some((r) => r.includes("Blocked term matched")));
  });

  await t.test("should apply missing URL penalty", () => {
    const event = { ...dummyEvent, url: "" };
    const result = scoreArticle({
      event,
      keywords: ["anime"],
      blockedTerms: [],
      trustedSource: false,
    });

    // Score: 0 - 10 (missing URL) = -10 (keyword doesn't match since it's not present)
    assert.equal(result.score, -10);
    assert.ok(result.reasons.some((r) => r.includes("Missing URL")));
  });

  await t.test("should allow negative scores (Option A - no floor)", () => {
    const event = { ...dummyEvent, title: "Sponsored", url: "" };
    const result = scoreArticle({
      event,
      keywords: [],
      blockedTerms: ["sponsored"],
      trustedSource: false,
    });

    // Score: 0 - 20 (blocked term) - 10 (missing URL) = -30
    assert.equal(result.score, -30);
    assert.equal(result.reasons.length, 2);
  });

  await t.test("should handle whole-word boundary matches and plurals (Solution C)", () => {
    const keywords = ["trailer"];

    // 1. Match singular
    const resultSingular = scoreArticle({
      event: { ...dummyEvent, title: "Watch the new trailer now" },
      keywords,
      blockedTerms: [],
      trustedSource: false,
    });
    assert.equal(resultSingular.score, 20);

    // 2. Match plural with 's'
    const resultPluralS = scoreArticle({
      event: { ...dummyEvent, title: "Check out these cool trailers" },
      keywords,
      blockedTerms: [],
      trustedSource: false,
    });
    assert.equal(resultPluralS.score, 20);

    // 3. Do not match partial word substring
    const resultSubstring = scoreArticle({
      event: { ...dummyEvent, title: "This is a trailerless post" },
      keywords,
      blockedTerms: [],
      trustedSource: false,
    });
    assert.equal(resultSubstring.score, 0);
  });

  await t.test("should filter articles based on duplicate flag and threshold", () => {
    // 1. Rejected as duplicate
    const filter1 = filterArticle({
      score: 100,
      threshold: 50,
      isDuplicate: true,
    });
    assert.equal(filter1.shouldPost, false);
    assert.ok(filter1.reasons.includes("Duplicate article"));

    // 2. Rejected below threshold
    const filter2 = filterArticle({
      score: 40,
      threshold: 50,
      isDuplicate: false,
    });
    assert.equal(filter2.shouldPost, false);
    assert.ok(filter2.reasons[0].includes("below threshold"));

    // 3. Approved meeting threshold
    const filter3 = filterArticle({
      score: 50,
      threshold: 50,
      isDuplicate: false,
    });
    assert.equal(filter3.shouldPost, true);
    assert.ok(filter3.reasons[0].includes("meets or exceeds threshold"));

    // 4. Approved exceeding threshold
    const filter4 = filterArticle({
      score: 65,
      threshold: 50,
      isDuplicate: false,
    });
    assert.equal(filter4.shouldPost, true);
    assert.ok(filter4.reasons[0].includes("meets or exceeds threshold"));
  });
});
