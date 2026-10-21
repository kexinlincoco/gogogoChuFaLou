import type { ReactNode } from "react";
import * as OpenCC from "opencc-js/t2cn";

/** Same Simplified normalization as backend/src/lib/textMatch.ts: many
 * reviews are written in Traditional ("乾淨"), tags and chat keywords are
 * Simplified ("干净"), so both sides are compared in Simplified. OpenCC's
 * conversion is 1:1 per character on this corpus, so a match position in the
 * Simplified copy is the same position in the original text. */
const convertToSimplified = OpenCC.Converter({ from: "hk", to: "cn" });
function toSimplified(text: string): string {
  return convertToSimplified(text) ?? text;
}

/** Escapes regex special characters so a keyword can be dropped straight
 * into a RegExp source string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same bidirectional-containment rule as backend/src/lib/textMatch.ts
 * (kept as a small duplicate here rather than a cross-package import,
 * frontend and backend are separate npm projects) — a descriptive phrase
 * built around a real tag ("靠近四合院" ~ "四合院") counts as the same need,
 * not just an exact string match. */
function keywordMatchesTag(keyword: string, tag: string): boolean {
  const k = toSimplified(keyword);
  const t = toSimplified(tag);
  return t.includes(k) || k.includes(t);
}

/** Mirrors NEED_TERMS in backend/src/lib/textMatch.ts: the related wordings
 * (including complaints like "尿骚味"/"头发") the backend now retrieves a
 * review by — highlighted too, so a snippet found via "脏" shows why. */
const NEED_TERMS: Record<string, string[]> = {
  干净: [
    "干净", "卫生", "整洁", "清洁", "洁净", "一尘不染",
    "脏", "异味", "怪味", "臭", "烟味", "霉味", "发霉", "霉斑", "骚味", "潮味",
    "头发", "毛发", "污渍", "污垢", "水垢", "黄渍", "灰尘", "积灰",
    "蟑螂", "虫子", "臭虫", "蚊子", "苍蝇", "蜘蛛",
    "柳絮", "垃圾",
  ],
};

function expandNeedTerms(keyword: string): string[] {
  const k = toSimplified(keyword.trim());
  const terms = new Set([k]);
  for (const [need, words] of Object.entries(NEED_TERMS)) {
    if (keywordMatchesTag(k, need) || words.some((w) => k.includes(w))) words.forEach((w) => terms.add(w));
  }
  return [...terms];
}

/** A few derived tag names are a real keyword plus a cosmetic "好" suffix
 * added for the tag pill's wording — e.g. seed.ts's
 * APIFY_TEXT_KEYWORD_TO_TAG matches literal "早餐"/"位置"/"服务好"'s "服务"
 * /"设施" in review text but labels the resulting tag "早餐好"/"位置好"/
 * "服务好"/"设施好". Real review text almost never contains that exact
 * 3-character tag name verbatim (people write "早餐人太多", not "早餐好"),
 * so searching for the tag name alone silently finds nothing even when the
 * review is genuinely about it. This adds the 2-character root as a second,
 * real thing to search for — never removes the original, only supplements
 * it, so a text that does contain the full tag name still matches on that. */
function withSuffixStripped(term: string): string[] {
  return term.length > 2 && term.endsWith("好") ? [term, term.slice(0, -1)] : [term];
}

/**
 * For each of the user's stated preferences, the real word worth searching
 * for in evidence text: the hotel's own matching tag when the preference is
 * a descriptive phrase built around it (e.g. "靠近四合院" ~ the real tag
 * "四合院"), otherwise the raw preference itself. Real review/reason text is
 * written by whoever wrote the review, not by whoever phrased the chat
 * preference — searching for the tag word finds real occurrences ("这家四
 * 合院很有味道") that searching for the user's exact phrase almost never
 * will.
 */
export function resolveHighlightTerms(prefer: string[], hotelTags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of prefer) {
    const k = raw.trim();
    if (!k) continue;
    const term = hotelTags.find((t) => keywordMatchesTag(k, t)) ?? k;
    if (!seen.has(term)) {
      seen.add(term);
      out.push(term);
    }
  }
  return out;
}

/**
 * Which of the user's stated preferences (slots.prefer) this ONE hotel's
 * actual evidence supports — checked against real text (tags/snippets/
 * reason), never assumed. This is what turns "AI 抓取了软需求" into
 * something visible: a keyword only lights up on a card if it's really
 * backed by something on that card.
 */
export function matchedKeywordsFor(prefer: string[], hotelTags: string[], snippets: { text: string }[], reason: string): string[] {
  const haystack = toSimplified([...hotelTags, ...snippets.map((s) => s.text), reason].join("\n"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of resolveHighlightTerms(prefer, hotelTags)) {
    const hit = term && withSuffixStripped(term).some((variant) => haystack.includes(toSimplified(variant)));
    if (hit && !seen.has(term)) {
      seen.add(term);
      out.push(term);
    }
  }
  return out;
}

/** Wraps every occurrence of any `keywords` substring in `text` with a
 * highlighted <mark>, so the exact word that matched the user's need is
 * visually called out inline in the reason / review snippet. Longest
 * keyword first so a longer match isn't shadowed by a shorter one nested
 * inside it. */
export function highlightKeywords(text: string, keywords: string[]): ReactNode {
  const kws = [...new Set(keywords.map((k) => toSimplified(k.trim())).filter(Boolean).flatMap(withSuffixStripped).flatMap(expandNeedTerms))].sort((a, b) => b.length - a.length);
  if (kws.length === 0) return text;
  const simplified = toSimplified(text);
  // Positions only carry over when conversion kept the length; otherwise
  // fall back to matching the original text directly.
  const haystack = simplified.length === text.length ? simplified : text;
  const re = new RegExp(kws.map(escapeRegExp).join("|"), "g");
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of haystack.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), hit: false });
    parts.push({ text: text.slice(start, start + m[0].length), hit: true });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.map(({ text: part, hit }, i) =>
    hit ? (
      <mark
        key={i}
        style={{
          background: "var(--highlight-bg)",
          color: "var(--venice-press)",
          borderRadius: 3,
          padding: "0 2px",
          fontWeight: 700,
        }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
