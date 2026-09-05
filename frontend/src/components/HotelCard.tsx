import { useState } from "react";
import type { HotelCandidate } from "../types";

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill={filled ? "#fff" : "none"} stroke="#fff" strokeWidth={1.8}>
      <path d="M12 21s-7.5-4.6-10-9.3C.4 8.2 2 4.5 5.6 4c2-.3 3.8.7 4.9 2.3C11.6 4.7 13.4 3.7 15.4 4c3.6.5 5.2 4.2 3.6 7.7C16.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function HouseIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
    </svg>
  );
}

// No real hotel photos are licensed for this mock dataset — imageUrl points
// at a theme-matched placeholder photo (see backend/src/services/images.ts).
// Falls back to the plain Rock Blue block + house icon if it fails to load.
function HotelImage({ src, alt, height }: { src: string; alt: string; height: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ position: "absolute", inset: 0, background: "var(--rock-blue)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {failed ? (
        <HouseIcon />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: "100%", height, objectFit: "cover", display: "block" }}
        />
      )}
    </div>
  );
}

export function HotelCard({
  candidate,
  likeBase,
  onOpen,
  onShowEvidence,
}: {
  candidate: HotelCandidate;
  likeBase: number;
  onOpen: () => void;
  onShowEvidence: () => void;
}) {
  const [liked, setLiked] = useState(false);
  const { hotel, reason } = candidate;
  const imgHeight = 130 + (hotel.base_price % 60);

  return (
    <div
      onClick={onOpen}
      style={{
        breakInside: "avoid",
        marginBottom: 10,
        background: "var(--surface)",
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid var(--border)",
        boxShadow: "0 6px 16px rgba(22,88,123,.08)",
        cursor: "pointer",
      }}
    >
      <div style={{ position: "relative", height: imgHeight }}>
        <HotelImage src={hotel.imageUrl} alt={hotel.name} height={imgHeight} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLiked((v) => !v);
          }}
          aria-label={liked ? "取消点赞" : "点赞"}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "rgba(22,88,123,.35)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <HeartIcon filled={liked} />
        </button>
      </div>

      <div style={{ padding: "11px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 13.5, color: "var(--venice-blue)", lineHeight: 1.3 }}>{hotel.name}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--venice-blue)" }}>
          ¥{hotel.samplePrice ?? hotel.base_price}
          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ink-faint)" }}>/晚</span>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {hotel.tags.map((t) => (
            <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: "var(--tag-bg)", color: "var(--venice-blue)" }}>
              {t}
            </span>
          ))}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onShowEvidence();
          }}
          style={{
            display: "flex",
            gap: 5,
            background: "var(--quote-bg)",
            border: "none",
            borderRadius: 10,
            padding: "7px 9px",
            textAlign: "left",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--rock-blue)", lineHeight: 0.6, flexShrink: 0 }}>&rdquo;</div>
          <p style={{ fontSize: 10.5, lineHeight: 1.45, color: "rgba(22,88,123,.8)", margin: 0 }}>{reason}</p>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--rock-blue)", flexShrink: 0 }} />
          <div style={{ fontSize: 10, color: "var(--ink-soft)", flex: 1 }}>来自真实住客评论</div>
          <div style={{ fontSize: 10.5, color: "var(--venice-blue)", fontWeight: 700 }}>{likeBase + (liked ? 1 : 0)} 人觉得有用</div>
        </div>
      </div>
    </div>
  );
}
