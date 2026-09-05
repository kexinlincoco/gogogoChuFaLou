import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../api/client";
import type { Hotel, Order, Review, ReviewHighlight } from "../types";
import { FeedbackQuestion } from "./FeedbackQuestion";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const AMEN_LABEL: Record<string, string> = { wifi: "WiFi", pool: "泳池", gym: "健身房", parking: "停车", breakfast: "早餐" };

export function BookingSheet({
  hotelId,
  prefer,
  sessionId,
  source = "manual_filter",
  authorName = "匿名住客",
  onClose,
  confirmAndPay,
}: {
  hotelId: string;
  prefer?: string[];
  sessionId?: string;
  source?: "ai_chat" | "manual_filter";
  authorName?: string;
  onClose: () => void;
  confirmAndPay: (input: { hotelId: string; checkin: string; checkout: string; guests: number }) => Promise<Order>;
}) {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewHighlight, setReviewHighlight] = useState<ReviewHighlight | null>(null);
  const [checkin, setCheckin] = useState(todayPlus(3));
  const [checkout, setCheckout] = useState(todayPlus(5));
  const [guests, setGuests] = useState(2);
  const [price, setPrice] = useState<{ nightly: number; total: number; nights: number } | null>(null);
  const [step, setStep] = useState<"review" | "paying" | "success">("review");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [satisfactionDone, setSatisfactionDone] = useState(false);

  useEffect(() => {
    // prefer (when known — e.g. opened from an AI recommendation card) makes
    // matching reviews surface first; opened from manual filter mode there's
    // no such context, so this just falls back to the highlight badge alone.
    api.getHotel(hotelId, checkin, checkout, prefer).then((r) => {
      setHotel(r.hotel);
      setReviews(r.reviews);
      setReviewHighlight(r.reviewHighlight);
      setPrice(r.price);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, checkin, checkout]);

  // PRD §10 conversion-funnel instrumentation: one event per distinct sheet
  // open (not per date edit, hence hotelId-only deps), independent of
  // whether the hotel data finishes loading. Guarded by a ref (not just the
  // effect dep array) because React 18 StrictMode deliberately double-fires
  // effects in dev — without the guard, "sheet_opened" would be inflated 2x
  // in `npm run dev` relative to `confirm_clicked`/`payment_completed`
  // (plain onClick handlers, unaffected by StrictMode), silently skewing the
  // funnel's drop-off numbers.
  const sheetOpenedLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    if (sheetOpenedLoggedRef.current === hotelId) return;
    sheetOpenedLoggedRef.current = hotelId;
    api.logFunnelEvent({ hotelId, sessionId, source, stage: "sheet_opened" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function handlePay() {
    api.logFunnelEvent({ hotelId, sessionId, source, stage: "confirm_clicked" });
    setError(null);
    setStep("paying");
    try {
      const o = await confirmAndPay({ hotelId, checkin, checkout, guests });
      api.logFunnelEvent({ hotelId, sessionId, source, stage: "payment_completed" });
      setOrder(o);
      setStep("success");
    } catch (e) {
      setStep("review");
      setError(e instanceof Error ? e.message : "预订失败，再试试？");
    }
  }


  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,40,55,.42)", zIndex: 30, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, maxHeight: "86%", background: "var(--merino)", borderRadius: "24px 24px 0 0", boxShadow: "0 -12px 30px rgba(15,66,92,.25)", display: "flex", flexDirection: "column" }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 999, background: "var(--border)", margin: "10px auto 4px", flexShrink: 0 }} />

        <div style={{ padding: "2px 16px 6px", flexShrink: 0 }}>
          <button
            onClick={onClose}
            aria-label="返回"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--venice-blue)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "6px 20px 4px" }}>
          {!hotel ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-faint)" }}>加载中…</div>
          ) : (
            <>
              <div style={{ height: 130, borderRadius: 14, background: "var(--rock-blue)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden" }}>
                <img
                  src={hotel.imageUrl}
                  alt={hotel.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--venice-blue)" }}>{hotel.name}</div>
              <div style={{ color: "var(--rock-blue)", fontSize: 13, letterSpacing: 1 }}>{"★".repeat(hotel.stars)}{"☆".repeat(5 - hotel.stars)}</div>
              {price && (
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--venice-blue)", marginTop: 4 }}>
                  ¥{price.nightly}
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-faint)" }}>/晚</span>
                </div>
              )}

              <div style={sectionTitle}>入住信息</div>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={dateBox}>
                  入住
                  <input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} style={dateInput} />
                </label>
                <label style={dateBox}>
                  离店
                  <input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} style={dateInput} />
                </label>
                <label style={dateBox}>
                  人数
                  <input type="number" min={1} max={6} value={guests} onChange={(e) => setGuests(Number(e.target.value))} style={dateInput} />
                </label>
              </div>

              <div style={sectionTitle}>设施</div>
              <div style={{ display: "flex", gap: 14, color: "var(--ink-soft)", fontSize: 11.5 }}>
                {hotel.amenities.map((a) => (
                  <div key={a}>{AMEN_LABEL[a] ?? a}</div>
                ))}
              </div>

              <div style={sectionTitle}>真实住客评论</div>
              {reviewHighlight && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--quote-bg)", borderRadius: 10, padding: "8px 10px", marginBottom: 8, fontSize: 11.5, color: "var(--venice-blue)" }}>
                  <span style={{ fontWeight: 700 }}>住客高频提到：{reviewHighlight.topic}</span>
                  <span style={{ color: "var(--ink-soft)" }}>
                    （{reviewHighlight.pct}%的评论，共{reviewHighlight.count}/{reviewHighlight.total}条提到）
                  </span>
                </div>
              )}
              {prefer && prefer.length > 0 && (
                <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginBottom: 8 }}>已优先显示和"{prefer.join("、")}"相关的评论</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                {reviews.slice(0, 4).map((r) => (
                  <div key={r.id} style={{ background: "var(--surface)", borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--venice-blue)" }}>{r.author}</div>
                      {r.source === "ai_collected" && (
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 999, background: "var(--tag-bg)", color: "var(--venice-blue)", fontWeight: 700 }}>
                          来自 AI 助手采集
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(22,88,123,.85)", lineHeight: 1.5 }}>{r.text}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "12px 20px 22px", flexShrink: 0, borderTop: "1px solid var(--border)" }}>
          {error && <div style={{ fontSize: 12, color: "#b3462c", marginBottom: 8 }}>{error}</div>}

          {step === "review" && price && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 13, color: "var(--ink-soft)" }}>
                <span>总价（{price.nights}晚）</span>
                <b style={{ color: "var(--venice-blue)", fontSize: 16 }}>¥{price.total}</b>
              </div>
              <button onClick={handlePay} style={payBtn}>
                确认预订并支付
              </button>
            </>
          )}
          {step === "paying" && (
            <button disabled style={{ ...payBtn, opacity: 0.7 }}>
              支付中…
            </button>
          )}
          {step === "success" && order && hotel && (
            <div style={{ textAlign: "center", padding: "6px 0 4px" }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--venice-blue)", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--venice-blue)" }}>预订成功！</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4, marginBottom: 14 }}>祝你在{hotel.name}玩得开心～</div>

              <div style={{ marginBottom: 14, textAlign: "left" }}>
                {satisfactionDone ? (
                  <div style={{ fontSize: 12.5, color: "var(--ink-soft)", textAlign: "center" }}>谢谢你的反馈～</div>
                ) : (
                  <FeedbackQuestion
                    kind="satisfaction"
                    prompt={source === "ai_chat" ? "这次AI帮你推荐的酒店，你满意吗？" : "这次预订的选择，你满意吗？"}
                    orderId={order.id}
                    hotelId={hotelId}
                    authorName={authorName}
                    onDone={() => setSatisfactionDone(true)}
                  />
                )}
              </div>

              <button onClick={onClose} style={payBtn}>
                完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const sectionTitle: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--venice-blue)", margin: "14px 0 6px" };
const dateBox: CSSProperties = { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "9px 10px", fontSize: 10.5, color: "var(--ink-faint)", display: "flex", flexDirection: "column", gap: 3 };
const dateInput: CSSProperties = { border: "none", outline: "none", fontSize: 12.5, color: "var(--venice-blue)", fontWeight: 600, background: "transparent", fontFamily: "inherit", width: "100%" };
const payBtn: CSSProperties = { background: "var(--venice-blue)", color: "#fff", textAlign: "center", padding: "13px 0", borderRadius: 14, fontSize: 14, fontWeight: 700, border: "none", width: "100%", cursor: "pointer" };
