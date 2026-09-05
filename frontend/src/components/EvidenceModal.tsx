import type { HotelCandidate } from "../types";

export function EvidenceModal({ candidate, onClose }: { candidate: HotelCandidate; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,40,55,.42)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: "70%",
          overflowY: "auto",
          background: "var(--merino)",
          borderRadius: "24px 24px 0 0",
          padding: "10px 20px 28px",
          boxShadow: "0 -12px 30px rgba(15,66,92,.25)",
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 999, background: "var(--border)", margin: "10px auto 16px" }} />
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--venice-blue)", marginBottom: 4 }}>
          {candidate.hotel.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 14 }}>推荐理由依据的真实评论片段</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {candidate.matchedSnippets.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>暂无强相关评论片段，理由基于整体评价氛围。</div>
          )}
          {candidate.matchedSnippets.map((s, i) => (
            <div key={i} style={{ background: "var(--surface)", borderRadius: 12, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--rock-blue)" }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--venice-blue)" }}>{s.author}</div>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(22,88,123,.85)" }}>{s.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
