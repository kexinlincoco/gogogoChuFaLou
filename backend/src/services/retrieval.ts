/**
 * The "R" in RAG (PRD §6.2 / §8): given a hotel and the preference keywords
 * pulled out of the conversation, pull only the review sentences that
 * actually support those keywords, plus a real matched/total ratio. The LLM
 * is only ever shown these snippets + the ratio when writing a recommendation
 * reason — it never free-generates a percentage or a claim with no snippet
 * behind it.
 */
import { getReviewsForHotel } from "../db/repo.js";
import type { Review } from "../types.js";
import { reviewMentions } from "../lib/textMatch.js";

export interface RetrievedEvidence {
  hotelId: string;
  matched: Review[];
  totalReviewCount: number;
  matchRatio: number; // matched.length / totalReviewCount, 0 when there are no reviews at all
}

/** Every review of the hotel backing at least one keyword (see
 * reviewMentions in lib/textMatch.ts). Unsliced — retrieveEvidence
 * caps it for the prompt; the offline eval (scripts/eval-level1.ts) needs all. */
export function findMatchingReviews(hotelId: string, preferKeywords: string[]): { all: Review[]; matched: Review[] } {
  const all = getReviewsForHotel(hotelId);
  const keywords = preferKeywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) return { all, matched: [] };
  const matched = all.filter((r) => keywords.some((k) => reviewMentions(r, k)));
  return { all, matched };
}

export function retrieveEvidence(hotelId: string, preferKeywords: string[]): RetrievedEvidence {
  const { all, matched } = findMatchingReviews(hotelId, preferKeywords);

  return {
    hotelId,
    matched: matched.slice(0, 4),
    totalReviewCount: all.length,
    matchRatio: all.length > 0 ? matched.length / all.length : 0,
  };
}
