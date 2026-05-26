const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "arent", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "cant", "cannot", "could", "couldnt",
  "did", "didnt", "do", "does", "doesnt", "doing", "dont", "down", "during",
  "each",
  "few", "for", "from", "further",
  "had", "hadnt", "has", "hasnt", "have", "havent", "having", "he", "hed", "hell", "hes", "her", "here", "heres", "hers", "herself", "him", "himself", "his", "how", "hows",
  "i", "id", "ill", "im", "ive", "if", "in", "into", "is", "isnt", "it", "its", "itself",
  "lets",
  "me", "more", "most", "mustnt", "my", "myself",
  "no", "nor", "not",
  "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
  "same", "shant", "she", "shed", "shell", "shes", "should", "shouldnt", "so", "some", "such",
  "than", "that", "thats", "the", "their", "theirs", "them", "themselves", "then", "there", "theres", "these", "they", "theyd", "theyll", "theyre", "theyve", "this", "those", "through", "to", "too", "under", "until", "up", "very",
  "was", "wasnt", "we", "wed", "well", "were", "weve", "werent", "what", "whats", "when", "whens", "where", "wheres", "which", "while", "who", "whos", "whom", "why", "whys", "with", "wont", "would", "wouldnt",
  "you", "youd", "youll", "youre", "youve", "your", "yours", "yourself", "yourselves"
]);

/**
 * Tokenizes a string by converting it to lowercase, removing punctuation, 
 * splitting by spaces, and filtering out standard English stop words.
 */
export function tokenize(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’[\]]/g, " "); // Replace punctuation with space

  const tokens = normalized.split(/\s+/);
  const filtered = tokens
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

  return new Set(filtered);
}

/**
 * Calculates the Jaccard similarity coefficient between two titles.
 * Returns a number between 0.0 (no matching words) and 1.0 (identical sets of words).
 */
export function calculateJaccardSimilarity(titleA: string, titleB: string): number {
  const setA = tokenize(titleA);
  const setB = tokenize(titleB);

  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionCount++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionCount;
  return intersectionCount / unionSize;
}

/**
 * Cleans a title for use as a Discord thread name.
 * Strips bracketed prefix topic tags (e.g., "[Toronto Eats]"), custom emojis, and standard emojis,
 * then truncates to 95 characters.
 */
export function cleanThreadTitle(title: string): string {
  let cleaned = title;

  // 1. Strip Discord custom emojis (<:emoji:id> or <a:emoji:id>)
  cleaned = cleaned.replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, "");

  // 2. Strip standard Unicode emojis
  try {
    cleaned = cleaned.replace(/\p{Extended_Pictographic}/gu, "");
    cleaned = cleaned.replace(/\p{Emoji_Presentation}/gu, "");
  } catch (e) {
    // Fallback if Unicode property escapes are not supported
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "");
  }

  // Trim to ensure bracketed prefix is at the start
  cleaned = cleaned.trim();

  // 3. Strip bracketed prefix at start (e.g., "[Topic Name]")
  cleaned = cleaned.replace(/^\[[^\]]+\]\s*/g, "");

  // 4. Trim extra spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 5. Truncate to 95 characters
  if (cleaned.length > 95) {
    cleaned = cleaned.substring(0, 92) + "...";
  }

  return cleaned || "New Story Thread";
}
