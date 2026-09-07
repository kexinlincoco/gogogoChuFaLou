import type { ReactNode } from "react";

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
  return tag.includes(keyword) || keyword.includes(tag);
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
  const haystack = [...hotelTags, ...snippets.map((s) => s.text), reason].join("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of resolveHighlightTerms(prefer, hotelTags)) {
    const hit = term && withSuffixStripped(term).some((variant) => haystack.includes(variant));
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
  const kws = [...new Set(keywords.map((k) => k.trim()).filter(Boolean).flatMap(withSuffixStripped))].sort((a, b) => b.length - a.length);
  if (kws.length === 0) return text;
  const re = new RegExp(`(${kws.map(escapeRegExp).join("|")})`, "g");
  const parts = text.split(re);
  return parts.map((part, i) =>
    kws.includes(part) ? (
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
