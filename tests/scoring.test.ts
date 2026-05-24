import assert from "node:assert/strict";
import test from "node:test";
import { scoreArticle } from "../src/processing/scoreArticle.js";
import { filterArticle } from "../src/processing/filterArticle.js";
import type { NormalizedEvent } from "../src/normalization/normalizedEvent.js";
import { normalizeUrl } from "../src/processing/hashUtils.js";

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

    // Score: 0 + 20 (title keyword) - 100 (blocked term) = -80
    assert.equal(result.score, -80);
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

    // Score: 0 - 100 (blocked term) - 10 (missing URL) = -110
    assert.equal(result.score, -110);
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

  await t.test("should filter articles based on duplicate flag, threshold, and publication age", () => {
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

    // 5. Rejected as too old
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const filterStale = filterArticle({
      score: 100,
      threshold: 50,
      isDuplicate: false,
      publishedAt: staleDate,
      maxAgeHours: 24,
    });
    assert.equal(filterStale.shouldPost, false);
    assert.ok(filterStale.reasons.some((r) => r.includes("exceeds max age")));

    // 6. Approved if within max age
    const freshDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
    const filterFresh = filterArticle({
      score: 100,
      threshold: 50,
      isDuplicate: false,
      publishedAt: freshDate,
      maxAgeHours: 24,
    });
    assert.equal(filterFresh.shouldPost, true);

    // 7. Approved if no date provided (fallback)
    const filterNoDate = filterArticle({
      score: 100,
      threshold: 50,
      isDuplicate: false,
      publishedAt: null,
      maxAgeHours: 24,
    });
    assert.equal(filterNoDate.shouldPost, true);
  });

  await t.test("should penalize and filter out sports betting keywords", () => {
    const sportsBlockedTerms = [
      "sponsored", "deal", "coupon", "bet", "bets", "betting", "wager", "wagers",
      "wagering", "sportsbook", "sportsbooks", "fanduel", "draftkings", "betmgm",
      "caesars", "pointsbet", "wynnbet", "betrivers", "fliff", "prizepicks",
      "underdog fantasy", "odds", "parlay", "parlays", "moneyline", "moneylines",
      "point spread", "point spreads", "spreads", "over/under", "over/unders",
      "over-under", "over-unders", "gambling", "gamble", "gambles", "gambler",
      "gamblers", "promo", "promo code", "promo codes", "payout", "payouts",
      "prop bet", "prop bets", "prop picks", "expert picks", "fantasy picks",
      "best picks", "vegas picks", "vegas odds", "bonus bet", "bonus bets",
      "free bet", "free bets", "bonus code", "bookmaker", "bookmakers",
      "bookie", "bookies", "casino", "casinos", "pick'em", "pick-em", "dfs", "ats"
    ];

    const bettingTitles = [
      "NBA player prop picks, odds: Three best 2026 NBA Playoffs prop bets for Thunder vs. Spurs, Game 3",
      "Use DraftKings promo code for $100 bonus bets by targeting Cavaliers-Knicks",
      "MLB DFS: Top DraftKings, FanDuel daily Fantasy baseball picks include Bobby Witt Jr.",
      "Use BetMGM bonus code CBSSPORTS to get $1,500 in bonus bets for Knicks-Cavaliers",
      "Knicks vs. Cavaliers odds, prediction: 2026 NBA Eastern Conference Finals picks, Game 3 bets by proven model",
      "Rockies vs. Diamondbacks MLB picks: Keep riding surging Arizona, Eduardo Rodriguez",
      "Free MLB home run picks, odds for May 21: Vlad Guerrero Jr. among expert's bets for Thursday HR player props",
      "Underdog Fantasy Promo Code and Best Picks for Wednesday, May 20",
      "PrizePicks promo code: Get $100 bonus for NBA playoffs player props"
    ];

    for (const title of bettingTitles) {
      const result = scoreArticle({
        event: {
          id: "test-betting",
          type: "news.article",
          topic: "nba",
          title,
          url: "https://example.com/nba/1",
          sourceName: "CBS Sports NBA",
          summary: "Check out these odds and prop bets!"
        },
        keywords: ["nba", "playoffs", "baseball"],
        blockedTerms: sportsBlockedTerms,
        trustedSource: true,
      });

      // Max base score: 20 (title match) + 10 (summary match) + 15 (trusted) = 45.
      // With -100 penalty, it must be <= -55.
      assert.ok(result.score <= -55, `Expected score <= -55 for title "${title}", got ${result.score}`);
      assert.ok(result.reasons.some((r) => r.includes("Blocked term matched")));
      
      const filterResult = filterArticle({
        score: result.score,
        threshold: 20,
        isDuplicate: false
      });
      assert.equal(filterResult.shouldPost, false);
    }
  });

  await t.test("should normalize various YouTube URLs to canonical format and strip tracking parameters", () => {
    const cases = [
      {
        input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        expected: "youtube.com/watch?v=dQw4w9WgXcQ",
      },
      {
        input: "https://youtube.com/watch?v=dQw4w9WgXcQ&feature=shared&utm_source=test",
        expected: "youtube.com/watch?v=dQw4w9WgXcQ",
      },
      {
        input: "https://youtu.be/dQw4w9WgXcQ?feature=shared",
        expected: "youtube.com/watch?v=dQw4w9WgXcQ",
      },
      {
        input: "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        expected: "youtube.com/watch?v=dQw4w9WgXcQ",
      },
      {
        input: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        expected: "youtube.com/watch?v=dQw4w9WgXcQ",
      },
      {
        input: "https://example.com/news/article-one?utm_source=twitter&keep_me=1",
        expected: "example.com/news/article-one?keep_me=1",
      },
      {
        input: "https://www.example.com/news/article-one/",
        expected: "example.com/news/article-one",
      },
    ];

    for (const { input, expected } of cases) {
      assert.equal(normalizeUrl(input), expected, `Failed for input: ${input}`);
    }
  });

});

