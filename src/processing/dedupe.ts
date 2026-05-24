import type { NormalizedEvent } from "../normalization/normalizedEvent.js";
import { findDuplicateArticle } from "../storage/articleRepo.js";

export type DedupeResult = {
  isDuplicate: boolean;
  reason?: "guid" | "urlHash" | "titleHash";
};

/**
 * Checks if a normalized event is a duplicate within its topic context.
 */
export async function checkDuplicate(
  event: NormalizedEvent,
  sharingTopics?: string[]
): Promise<DedupeResult> {
  const result = await findDuplicateArticle(
    event.topic,
    event.id,
    event.url,
    event.title,
    sharingTopics
  );

  if (result) {
    return {
      isDuplicate: true,
      reason: result.reason,
    };
  }

  return {
    isDuplicate: false,
  };
}
