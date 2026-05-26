import assert from "node:assert/strict";
import test from "node:test";
import { tokenize, calculateJaccardSimilarity, cleanThreadTitle } from "../src/processing/similarity.js";

test("Similarity Engine Suite", async (t) => {
  await t.test("tokenize - should lowercase, remove punctuation, and filter stop words", () => {
    const text = "The quick brown fox jumps over a lazy dog, and some other words!";
    const tokens = tokenize(text);

    // Stop words like "the", "over", "a", "and", "some", "other" should be removed.
    // Punctuation like "," and "!" should be removed.
    assert.ok(tokens.has("quick"));
    assert.ok(tokens.has("brown"));
    assert.ok(tokens.has("fox"));
    assert.ok(tokens.has("jumps"));
    assert.ok(tokens.has("lazy"));
    assert.ok(tokens.has("dog"));
    assert.ok(tokens.has("words"));

    assert.ok(!tokens.has("the"));
    assert.ok(!tokens.has("a"));
    assert.ok(!tokens.has("and"));
    assert.ok(!tokens.has("fox,"));
  });

  await t.test("calculateJaccardSimilarity - identical titles", () => {
    const titleA = "Michelin Guide 2026: New Stars Announced for Toronto Restaurants";
    const titleB = "Michelin Guide 2026: New Stars Announced for Toronto Restaurants!";
    const similarity = calculateJaccardSimilarity(titleA, titleB);
    assert.equal(similarity, 1.0);
  });

  await t.test("calculateJaccardSimilarity - completely different titles", () => {
    const titleA = "Michelin Guide 2026: New Stars Announced";
    const titleB = "Stunning weather forecast for tomorrow morning";
    const similarity = calculateJaccardSimilarity(titleA, titleB);
    assert.equal(similarity, 0.0);
  });

  await t.test("calculateJaccardSimilarity - partially similar titles", () => {
    // Title A tokens (filtered): ["michelin", "guide", "2026", "new", "stars", "announced", "toronto"]
    // Title B tokens (filtered): ["michelin", "guide", "2026", "adds", "three", "new", "toronto", "restaurants"]
    // Intersection: ["michelin", "guide", "2026", "new", "toronto"] (Size = 5)
    // Union: ["michelin", "guide", "2026", "new", "stars", "announced", "toronto", "adds", "three", "restaurants"] (Size = 10)
    // Jaccard: 5 / 10 = 0.5
    const titleA = "Michelin Guide 2026: New Stars Announced for Toronto";
    const titleB = "Michelin Guide 2026 Adds Three New Toronto Restaurants";
    const similarity = calculateJaccardSimilarity(titleA, titleB);
    assert.equal(similarity, 0.5);
  });

  await t.test("cleanThreadTitle - strips bracketed prefixes, emojis, and truncates", () => {
    const input = "🍕 [Toronto Eats] Michelin Guide 2026: New Stars Announced for Toronto Restaurants and Food Places in Ontario Canada";
    const cleaned = cleanThreadTitle(input);

    // Emojis stripped: "🍕" removed
    // Prefix stripped: "[Toronto Eats]" removed
    // Truncated to <= 95 chars (92 chars + "...")
    assert.ok(!cleaned.includes("🍕"));
    assert.ok(!cleaned.includes("Toronto Eats"));
    assert.ok(cleaned.startsWith("Michelin Guide 2026"));
    assert.ok(cleaned.endsWith("..."));
    assert.ok(cleaned.length <= 95);
  });

  await t.test("cleanThreadTitle - strips custom Discord emojis", () => {
    const input = "<:torontoeats:1234567890> Michelin Guide updates";
    const cleaned = cleanThreadTitle(input);
    assert.equal(cleaned, "Michelin Guide updates");
  });
});
