import * as OpenCC from "opencc-js/t2cn";

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
  const k = toSimplified(keyword);
  const t = toSimplified(tag);
  return t.includes(k) || k.includes(t);
}

/**
 * 835 of the 1,382 imported reviews contain Traditional characters
 * ("乾淨"/"安靜"), while tags and chat keywords are Simplified — a plain
 * `includes` silently missed all of them (e.g. 汉庭's "干净" went from 0 to
 * 34 hits). Every text-vs-keyword comparison goes through this so both sides
 * are compared in Simplified; the displayed text itself is left untouched.
 * OpenCC's HK/TW→CN conversion is 1:1 per character on this corpus (verified:
 * no length changes), which the frontend's highlighter relies on.
 */
const convertToSimplified = OpenCC.Converter({ from: "hk", to: "cn" });
const simplifiedCache = new Map<string, string>();

export function toSimplified(text: string): string {
  const cached = simplifiedCache.get(text);
  if (cached !== undefined) return cached;
  const s: string = convertToSimplified(text) ?? text;
  simplifiedCache.set(text, s);
  return s;
}

/**
 * Topics the seed derives from a review's star sub-scores (seed.ts: e.g.
 * Cleanliness >= 4.5 → "干净"), not from anything the reviewer wrote. As
 * evidence they're noise: 148 of 北京索菲特's 200 "干净"-tagged reviews never
 * mention cleanliness at all (eval/level1). Evidence matching ignores them and
 * relies on the text; travel-type / room-type topics come from structured
 * fields and stay usable.
 */
export const RATING_DERIVED_TOPICS = new Set(["干净", "位置好", "服务好", "设施好"]);

/**
 * Related wordings per need, including how people complain — nobody writes
 * "不干净" when the bathroom smells; they write "尿骚味"/"头发"/"蟑螂". Searching
 * only the need word itself missed 4 of the 6 cleanliness complaints in
 * eval/level1, skewing evidence toward praise. Deliberately excludes
 * ambiguous words ("味道" is often "老北京的味道", "霉" alone hits "倒霉").
 */
const NEED_TERMS: Record<string, string[]> = {
  干净: [
    "干净", "卫生", "整洁", "清洁", "洁净", "一尘不染",
    "脏", "异味", "怪味", "臭", "烟味", "霉味", "发霉", "霉斑", "骚味", "潮味",
    "头发", "毛发", "污渍", "污垢", "水垢", "黄渍", "灰尘", "积灰",
    "蟑螂", "虫子", "臭虫", "蚊子", "苍蝇", "蜘蛛",
    "柳絮", "垃圾",
  ],
};

/** The keyword itself plus the related wordings of any need it refers to
 * ("干净", "卫生好" and "房间干净吗" all map to the 干净 list). */
export function expandNeedTerms(keyword: string): string[] {
  const k = toSimplified(keyword.trim());
  const terms = new Set([k]);
  for (const [need, words] of Object.entries(NEED_TERMS)) {
    if (keywordMatchesTag(k, need) || words.some((w) => k.includes(w))) words.forEach((w) => terms.add(w));
  }
  return [...terms];
}

/** Whether a review is evidence for a user's need: a non-rating-derived topic
 * matches it, or the text contains the need or one of its related wordings.
 * The single definition shared by retrieval, detail sorting and topic stats. */
export function reviewMentions(review: { topics: string[]; text: string }, keyword: string): boolean {
  if (review.topics.some((t) => !RATING_DERIVED_TOPICS.has(t) && keywordMatchesTag(keyword, t))) return true;
  const text = toSimplified(review.text);
  return expandNeedTerms(keyword).some((term) => text.includes(term));
}
