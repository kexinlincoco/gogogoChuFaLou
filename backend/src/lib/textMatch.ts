/**
 * Whether a free-text preference/avoid keyword (whatever exact phrase the AI
 * extracted from the conversation, e.g. "靠近四合院") should count as the
 * same need as a fixed-vocabulary tag/topic (e.g. "四合院", see seed.ts's
 * derivation logic). Bidirectional substring containment rather than exact
 * equality — a descriptive phrase built around the tag ("靠近X"/"X风格"/
 * "喜欢X") still means the same thing, and previously only an
 * exact-string-equal keyword could ever match, so almost nothing did.
 *
 * Still deliberately NOT semantic/synonym matching (e.g. "商务酒店" won't
 * match "商务出行") — that would need an LLM or embedding call and risks
 * inventing a match with nothing real behind it, which conflicts with this
 * app's no-fabrication RAG design elsewhere. Substring containment is the
 * furthest this can go while staying a plain, deterministic, always-real
 * check (see PRD §9 "偏好词匹配偏差" for this accepted remaining limitation).
 */
export function keywordMatchesTag(keyword: string, tag: string): boolean {
  return tag.includes(keyword) || keyword.includes(tag);
}
