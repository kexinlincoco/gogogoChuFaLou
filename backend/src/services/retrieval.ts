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

export interface RetrievedEvidence {
  hotelId: string;
  matched: Review[];
  totalReviewCount: number;
  matchRatio: number; // matched.length / totalReviewCount, 0 when there are no reviews at all
}

export function retrieveEvidence(hotelId: string, preferKeywords: string[]): RetrievedEvidence {
  const all = getReviewsForHotel(hotelId);
  const keywords = preferKeywords.map((k) => k.trim()).filter(Boolean);

  let matched: Review[];
  if (keywords.length === 0) {
    matched = all.slice(0, 2);
  } else {
    matched = all.filter((r) => r.topics.some((t) => keywords.includes(t)) || keywords.some((k) => r.text.includes(k)));
    if (matched.length === 0) matched = all.slice(0, 2);
  }

  return {
    hotelId,
    matched: matched.slice(0, 4),
    totalReviewCount: all.length,
    matchRatio: all.length > 0 ? matched.length / all.length : 0,
  };
}
