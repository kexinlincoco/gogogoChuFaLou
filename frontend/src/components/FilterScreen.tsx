import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import type { Hotel } from "../types";

// v0.5: dropped 健身房 (low real-world usage for the leisure-traveler
// segment this product targets, per §4) in favor of higher-frequency,
// broadly-searched amenities; 停车 fills a gap that PRD §6.4 already
// promised but the UI never actually implemented.
// v0.6: dropped WiFi/空调 too — every hotel in the dataset has both, so
// toggling them never actually narrows a result set. Kept only amenities
// that some hotels have and others don't.
// v0.11: 泳池 removed outright per explicit request — it's no longer offered
// as a filter anywhere (not here, not as a preference tag either). The
// underlying hotel data still carries it; only the picker stops surfacing it.
const AMENITIES: { key: string; label: string; icon: string }[] = [
  { key: "breakfast", label: "早餐", icon: "M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9zM16 10.5h1.5a2.2 2.2 0 0 1 0 4.4H16M7 4.5v2M10.5 4.5v2M14 4.5v2" },
  { key: "parking", label: "停车", icon: "M12 3a9 9 0 1 0 .001 0zM10 8v8M10 8h3a2.5 2.5 0 0 1 0 5h-3" },
  { key: "gym", label: "健身房", icon: "M6 7v10M18 7v10M6 12h12M4 9v6M20 9v6" },
];

// v0.11: "住客评价关键词" category dropped entirely (安静/性价比 no longer
// filterable here), and 泳池 dropped along with it (see 设施 above). The 3
// remaining categories each grew to 5 same-type tags — restoring 近古城/近海滩
// (genuinely location-type, previously hidden only for being individually
// niche) and introducing new tags (大床房/庭院/山景/商务出行/朋友出游/独自
// 旅行/近火车站) so each category has real breadth instead of just 2 tags.
const HIDDEN_FROM_FILTER = new Set(["安静", "性价比", "泳池"]);

// Groups the dynamic tag vocabulary (fetched from the backend, not hardcoded
// data) under sensible headings; a tag that doesn't match any bucket falls
// into "其他偏好" so new dataset tags never silently disappear — but with
// v0.11's tag roster every real tag has a home, so that bucket stays empty in
// practice. Tags are listed high-to-low by how many hotels carry them, and
// the UI renders them in that order (not alphabetically or insertion order).
const TAG_CATEGORIES: { label: string; tags: string[] }[] = [
  { label: "位置", tags: ["近古城", "近地铁", "市中心", "近火车站", "近海滩"] },
  { label: "景观房型", tags: ["大床房", "海景房", "湖景", "庭院", "山景"] },
  { label: "适合人群", tags: ["亲子友好", "情侣推荐", "商务出行", "朋友出游", "独自旅行"] },
];

const PRICE_MIN = 200;
// Wide enough to cover the priciest real hotel (纽约1680) with headroom —
// 1200 predated the real-data migration and silently made 澳门(1280)/纽约(1680)
// unreachable at any slider position (found during a PRD-audit pass, not by design).
const PRICE_MAX = 2000;
// Evenly-spaced tick marks + labels under the slider, so "¥300 - ¥1800" isn't
// the only way to read the range — matches the reference look of a labeled
// progress-bar-style slider rather than a bare number readout.
const PRICE_TICKS = [200, 500, 800, 1100, 1400, 1700, 2000];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function FilterScreen({ onOpenHotel, onAskAi }: { onOpenHotel: (hotelId: string) => void; onAskAi: () => void }) {
  const [cities, setCities] = useState<string[]>([]);
  // No hardcoded default city — "三亚" predated the real-data migration and
  // has zero real hotel coverage, so it silently showed "0家酒店" on first
  // load. Empty means "不限" (all covered cities), which stays correct
  // automatically as the dataset changes.
  const [dest, setDest] = useState("");
  const [checkin, setCheckin] = useState(todayPlus(3));
  const [checkout, setCheckout] = useState(todayPlus(5));
  const [priceLo, setPriceLo] = useState(300);
  const [priceHi, setPriceHi] = useState(1800); // covers all 4 real hotels' base prices (980–1680)
  const [starMax, setStarMax] = useState(0); // 0 = 不限; N = "N星及以下"
  const [amenities, setAmenities] = useState<Set<string>>(new Set());
  const [allTags, setAllTags] = useState<string[]>([]);
  const [prefTags, setPrefTags] = useState<Set<string>>(new Set());
  const [count, setCount] = useState<number | null>(null);
  const [results, setResults] = useState<Hotel[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Star widget is "N stars and below" — translate to the discrete list the
  // (unchanged) backend filter expects; only 3/4/5-star hotels exist in the
  // dataset, so starMax 1 or 2 yields an empty list, which the API client
  // treats the same as "no filter" (equivalent to 不限, not "show nothing").
  function starsParam(): number[] | undefined {
    return starMax > 0 ? [3, 4, 5].filter((n) => n <= starMax) : undefined;
  }

  useEffect(() => {
    api.cities().then((r) => setCities(r.cities)).catch(() => {});
    api.tags().then((r) => setAllTags(r.tags.filter((t) => !HIDDEN_FROM_FILTER.has(t)))).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listHotels({
        city: dest || undefined,
        priceMin: priceLo,
        priceMax: priceHi,
        stars: starsParam(),
        amenities: amenities.size ? [...amenities] : undefined,
        tags: prefTags.size ? [...prefTags] : undefined,
        sort: "price",
      })
      .then((r) => {
        if (cancelled) return;
        setCount(r.count);
        if (results !== null) setResults(r.hotels); // keep list live once opened
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, priceLo, priceHi, starMax, amenities, prefTags]);

  async function showResults() {
    const r = await api.listHotels({
      city: dest || undefined,
      priceMin: priceLo,
      priceMax: priceHi,
      stars: starsParam(),
      amenities: amenities.size ? [...amenities] : undefined,
      tags: prefTags.size ? [...prefTags] : undefined,
      sort: "price",
    });
    setResults(r.hotels);
    setCount(r.count);
  }

  function toggleAmenity(key: string) {
    setAmenities((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function togglePrefTag(tag: string) {
    setPrefTags((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }

  const loPct = ((priceLo - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
  const hiPct = ((priceHi - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={fieldLabel}>目的地</div>
        <input
          list="city-options"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="不限（默认展示全部覆盖城市）"
          style={fieldInput}
        />
        <datalist id="city-options">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div>
        <div style={fieldLabel}>入住日期</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, ...fieldBox }}>
            <div style={fieldSubLabel}>入住</div>
            <input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} style={dateInput} />
          </div>
          <div style={{ flex: 1, ...fieldBox }}>
            <div style={fieldSubLabel}>离店</div>
            <input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} style={dateInput} />
          </div>
        </div>
      </div>

      <div>
        <div style={{ ...fieldLabel, display: "flex", justifyContent: "space-between" }}>
          <span>价格区间</span>
          <span>
            ¥{priceLo} - ¥{priceHi}
          </span>
        </div>
        <div style={{ position: "relative", height: 28, display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: 0, right: 0, height: 5, borderRadius: 999, background: "rgba(132,179,206,.3)" }} />
          <div style={{ position: "absolute", height: 5, borderRadius: 999, background: "var(--venice-blue)", left: `${loPct}%`, right: `${100 - hiPct}%` }} />
          <input
            type="range"
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={50}
            value={priceLo}
            onChange={(e) => setPriceLo(Math.min(Number(e.target.value), priceHi - 100))}
            className="range-thumb"
            style={rangeInput}
          />
          <input
            type="range"
            min={PRICE_MIN}
            max={PRICE_MAX}
            step={50}
            value={priceHi}
            onChange={(e) => setPriceHi(Math.max(Number(e.target.value), priceLo + 100))}
            className="range-thumb"
            style={rangeInput}
          />
        </div>
        <div style={{ position: "relative", height: 24, marginTop: 2 }}>
          {PRICE_TICKS.map((v, i) => {
            const pct = ((v - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
            const edgeStyle: CSSProperties =
              i === 0
                ? { left: 0, alignItems: "flex-start" }
                : i === PRICE_TICKS.length - 1
                  ? { left: "auto", right: 0, alignItems: "flex-end" }
                  : { left: `${pct}%`, transform: "translateX(-50%)", alignItems: "center" };
            return (
              <div key={v} style={{ position: "absolute", display: "flex", flexDirection: "column", gap: 3, ...edgeStyle }}>
                <div style={{ width: 1.5, height: 6, background: "var(--border)" }} />
                <div style={{ fontSize: 9.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>¥{v}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={fieldLabel}>星级</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => {
            const lit = n <= starMax;
            return (
              <button
                key={n}
                onClick={() => setStarMax((prev) => (prev === n ? 0 : n))}
                aria-label={`${n}星`}
                aria-pressed={lit}
                style={{ background: "none", border: "none", padding: 3, cursor: "pointer", lineHeight: 0 }}
              >
                <svg
                  width={26}
                  height={26}
                  viewBox="0 0 24 24"
                  style={lit ? { filter: "drop-shadow(0 0 4px rgba(22,88,123,.6))" } : undefined}
                >
                  <path
                    d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9z"
                    fill={lit ? "var(--venice-blue)" : "rgba(132,179,206,.3)"}
                    stroke={lit ? "var(--venice-blue)" : "rgba(22,88,123,.3)"}
                    strokeWidth={1}
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            );
          })}
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)", marginLeft: 4 }}>{starMax === 0 ? "不限星级" : `${starMax}星及以下`}</span>
        </div>
      </div>

      <div>
        <div style={fieldLabel}>设施</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 7 }}>
          {AMENITIES.map((a) => {
            const on = amenities.has(a.key);
            return (
              <button
                key={a.key}
                onClick={() => toggleAmenity(a.key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "9px 4px",
                  borderRadius: 12,
                  background: on ? "var(--venice-blue)" : "rgba(132,179,206,.2)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={on ? "#fff" : "#16587B"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={a.icon} />
                </svg>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: on ? "#fff" : "var(--venice-blue)" }}>{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ ...fieldLabel, display: "flex", justifyContent: "space-between" }}>
          <span>偏好标签</span>
          {prefTags.size > 0 && <span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>选中任意一个即可匹配</span>}
        </div>
        {allTags.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>加载中…</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              ...TAG_CATEGORIES.map((c) => ({ label: c.label, tags: c.tags.filter((t) => allTags.includes(t)) })),
              { label: "其他偏好", tags: allTags.filter((t) => !TAG_CATEGORIES.some((c) => c.tags.includes(t))) },
            ]
              .filter((c) => c.tags.length > 0)
              .map((c) => (
                <div key={c.label}>
                  <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginBottom: 5 }}>{c.label}</div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {c.tags.map((t) => (
                      <button key={t} onClick={() => togglePrefTag(t)} style={chipStyle(prefTags.has(t))}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <button
        onClick={showResults}
        style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10, background: "var(--venice-blue)", color: "#fff", padding: "13px 16px", borderRadius: 14, border: "none", cursor: "pointer" }}
      >
        <span style={{ fontSize: 14, fontWeight: 700 }}>{loading ? "计算中…" : `查看 ${count ?? 0} 家酒店`}</span>
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,.6)" }}>
          <span>排序</span>
          <span style={{ color: "rgba(255,255,255,.85)" }}>价格从低到高</span>
        </span>
      </button>

      <button onClick={onAskAi} style={{ textAlign: "center", fontSize: 11.5, color: "var(--venice-blue)", fontWeight: 600, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 6 }}>
        ↺ 跟 AI 聊聊，让 TA 帮你从筛选结果里挑一挑
      </button>

      {results && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {results.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-faint)", fontSize: 12, padding: "20px 0" }}>没有匹配的酒店，试试放宽条件～</div>}
          {results.map((h) => (
            <div
              key={h.id}
              onClick={() => onOpenHotel(h.id)}
              style={{ display: "flex", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 9, cursor: "pointer", boxShadow: "0 4px 12px rgba(22,88,123,.06)" }}
            >
              <div style={{ width: 64, height: 64, borderRadius: 10, background: "var(--rock-blue)", flexShrink: 0, overflow: "hidden" }}>
                <img
                  src={h.imageUrl}
                  alt={h.name}
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, justifyContent: "center" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--venice-blue)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>
                  {h.city} · {"★".repeat(h.stars)} · {h.tags[0] ?? ""}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--venice-blue)" }}>
                  ¥{h.samplePrice ?? h.base_price}
                  <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ink-faint)" }}>/晚</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const fieldLabel: CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--venice-blue)", marginBottom: 6 };
const fieldSubLabel: CSSProperties = { fontSize: 10.5, color: "var(--ink-faint)" };
const fieldInput: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "11px 13px",
  fontSize: 13.5,
  color: "var(--venice-blue)",
  fontWeight: 600,
  width: "100%",
  outline: "none",
};
const fieldBox: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px" };
const dateInput: CSSProperties = { border: "none", outline: "none", fontSize: 13, color: "var(--venice-blue)", fontWeight: 600, background: "transparent", width: "100%", fontFamily: "inherit" };
const rangeInput: CSSProperties = { position: "absolute", width: "100%", margin: 0, background: "transparent", pointerEvents: "none" as const, appearance: "none" as const, WebkitAppearance: "none" };

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    background: active ? "var(--venice-blue)" : "rgba(132,179,206,.25)",
    color: active ? "#fff" : "var(--venice-blue)",
  };
}
