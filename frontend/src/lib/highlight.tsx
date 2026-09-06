import type { ReactNode } from "react";

/** Escapes regex special characters so a keyword can be dropped straight
 * into a RegExp source string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  for (const raw of prefer) {
    const k = raw.trim();
    if (k && haystack.includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
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
  const kws = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
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
