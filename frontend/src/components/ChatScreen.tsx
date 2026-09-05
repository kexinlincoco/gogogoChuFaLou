import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { ChatItem, HotelCandidate, User } from "../types";
import { AIAvatar } from "./AIAvatar";
import { HotelWaterfall } from "./HotelWaterfall";
import { EvidenceModal } from "./EvidenceModal";
import { FeedbackQuestion } from "./FeedbackQuestion";

// v0.15修正：之前这三条示例分别提到三亚/厦门/大理，但真实数据集只覆盖北京/
// 杭州/澳门/纽约（见PRD §8），点这些示例反而会立刻触发"这个城市没有数据"的
// 诚实兜底话术——对刚打开App的用户来说是很差的第一印象。换成真实覆盖的城市，
// 并贴合第四章记录的"数据集偏商务/高端"这条局限（见PRD §9），不再假装是海边度假。
const QUICKFILLS = [
  "这周末去北京出差，一个人，预算1200一晚，想要干净安静的",
  "带家人去澳门玩，两个人，预算1500左右，想要设施好、服务好的",
  "去杭州出差，预算1200，想要位置好又干净的",
];

let idCounter = 0;
function uid(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function ChatScreen({
  sessionId,
  user,
  userName,
  onOpenHotel,
}: {
  sessionId: string;
  user: User | null;
  userName: string | null;
  onOpenHotel: (hotelId: string, prefer?: string[], source?: "ai_chat" | "manual_filter") => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<HotelCandidate | null>(null);
  // Portal target for "things the user can currently pick" (quickfills,
  // followup-question choices) — rendered anchored above the input box
  // instead of inline in the transcript, per the requested "options belong
  // near where the user acts, not attached to the AI's own message" fix.
  const [actionBarEl, setActionBarEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initedRef = useRef(false);
  const followupCheckedForUser = useRef<string | null>(null);

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    setItems([
      {
        kind: "ai-text",
        id: uid("ai"),
        text: userName ? `嗨，${userName}～这次想去哪儿玩呀？和我聊聊目的地、预算和心情，我来帮你挑酒店。` : "嗨～这次想去哪儿玩呀？和我聊聊目的地、预算和心情，我来帮你挑酒店。",
      },
      { kind: "quickfills", id: uid("qf"), prompts: QUICKFILLS },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    if (followupCheckedForUser.current === user.id) return;
    followupCheckedForUser.current = user.id;
    api
      .followupPending(user.id)
      .then(({ pending }) => {
        if (!pending) return;
        setTimeout(() => {
          setItems((prev) => [
            ...prev,
            {
              kind: "followup-question",
              id: uid("fu"),
              orderId: pending.order.id,
              hotelId: pending.hotel.id,
              hotelName: pending.hotel.name,
            },
          ]);
        }, 1200);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);
    setItems((prev) => [
      ...prev.filter((i) => i.kind !== "quickfills"),
      { kind: "user-text", id: uid("u"), text: trimmed },
      { kind: "typing", id: "typing" },
    ]);

    try {
      const result = await api.sendChatMessage(sessionId, trimmed, userName ?? undefined);
      setItems((prev) => {
        const withoutTyping = prev.filter((i) => i.id !== "typing");
        if (result.type === "recommend") {
          return [
            ...withoutTyping,
            { kind: "ai-text", id: uid("ai"), text: result.reply },
            { kind: "hotel-cards", id: uid("cards"), hotels: result.hotels, prefer: result.slots.prefer },
          ];
        }
        return [...withoutTyping, { kind: "ai-text", id: uid("ai"), text: result.reply }];
      });
    } catch (e) {
      setItems((prev) => [
        ...prev.filter((i) => i.id !== "typing"),
        { kind: "ai-text", id: uid("ai"), text: "网络好像有点问题，要不再试一次？" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onFollowupDone(review: import("../types").Review | undefined) {
    // Reaching "finished" with no review only happens via a skip (a real
    // stay_experience answer always produces one) — a skip at either
    // question ends the whole flow, so this closes it with a warm,
    // no-pressure line instead of thanking for feedback never given.
    // Deliberately NOT "下次再问你" (I'll ask you again) — that reads as
    // the AI chasing the user for an answer, which is the opposite of
    // encouraging; leave the door open without implying a follow-up push.
    setItems((prev) => [
      ...prev,
      { kind: "ai-text", id: uid("ai"), text: review ? "谢谢你的反馈！已经帮你记录啦～" : "好的，不打扰你啦～之后什么时候想聊聊住的感受，随时都欢迎告诉我～" },
      ...(review
        ? [
            { kind: "review-preview" as const, id: uid("rp"), author: user?.phone ? "我" : "匿名住客", text: review.text, date: new Date().toLocaleDateString("zh-CN") },
          ]
        : []),
    ]);
  }

  const quickfillsItem = items.find((i): i is Extract<ChatItem, { kind: "quickfills" }> => i.kind === "quickfills");

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "6px 16px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item) => (
          <ChatItemView
            key={item.id}
            item={item}
            onOpenHotel={onOpenHotel}
            onShowEvidence={setEvidence}
            onFollowupDone={onFollowupDone}
            authorName={user?.phone ? "我" : "匿名住客"}
          />
        ))}
      </div>

      <div ref={setActionBarEl} style={{ flexShrink: 0 }}>
        {actionBarEl &&
          quickfillsItem &&
          createPortal(
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 16px 0" }}>
              {quickfillsItem.prompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  style={{
                    textAlign: "left",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "9px 12px",
                    fontSize: 12,
                    color: "var(--ink-soft)",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>,
            actionBarEl
          )}
      </div>

      <div style={{ padding: "10px 16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", background: "var(--merino)", flexShrink: 0 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send(input);
          }}
          placeholder="跟我说说你的旅行计划…"
          aria-label="输入消息"
          style={{
            flex: 1,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "11px 16px",
            fontSize: 13,
            color: "var(--ink)",
            outline: "none",
          }}
        />
        <button
          onClick={() => send(input)}
          aria-label="发送"
          disabled={busy}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--venice-blue)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {evidence && <EvidenceModal candidate={evidence} onClose={() => setEvidence(null)} />}
    </div>
  );
}

function ChatItemView({
  item,
  onOpenHotel,
  onShowEvidence,
  onFollowupDone,
  authorName,
}: {
  item: ChatItem;
  onOpenHotel: (hotelId: string, prefer?: string[], source?: "ai_chat" | "manual_filter") => void;
  onShowEvidence: (c: HotelCandidate) => void;
  onFollowupDone: (review: import("../types").Review | undefined) => void;
  authorName: string;
}) {
  const bubbleBase: CSSProperties = { padding: "11px 14px", maxWidth: "78%", fontSize: 13.5, lineHeight: 1.55 };

  switch (item.kind) {
    case "ai-text":
      if (!item.text) return null;
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <AIAvatar size={28} />
          <div style={{ ...bubbleBase, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)", borderRadius: "16px 16px 16px 4px" }}>
            {item.text}
          </div>
        </div>
      );
    case "user-text":
      return (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ ...bubbleBase, background: "var(--venice-blue)", color: "#fff", borderRadius: "16px 16px 4px 16px" }}>{item.text}</div>
        </div>
      );
    case "typing":
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <AIAvatar size={28} />
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "16px 16px 16px 4px",
              padding: "11px 16px",
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 12.5,
              color: "var(--ink-soft)",
            }}
          >
            <span>对方正在输入</span>
            <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <span className="typing-dot" style={{ ...dotStyle(1), animationDelay: "0s" }} />
              <span className="typing-dot" style={{ ...dotStyle(1), animationDelay: "0.15s" }} />
              <span className="typing-dot" style={{ ...dotStyle(1), animationDelay: "0.3s" }} />
            </span>
          </div>
        </div>
      );
    case "quickfills":
      // Rendered in the action bar above the input (see ChatScreen), not
      // inline here — these are options for the user to pick, not part of
      // the AI's own message stream.
      return null;
    case "hotel-cards":
      return (
        <div style={{ paddingLeft: 36 }}>
          <HotelWaterfall hotels={item.hotels} onOpenHotel={(hotelId) => onOpenHotel(hotelId, item.prefer, "ai_chat")} onShowEvidence={onShowEvidence} />
        </div>
      );
    case "followup-question":
      return <FollowupFlow item={item} authorName={authorName} onDone={onFollowupDone} />;
    case "review-preview":
      return (
        <div style={{ background: "var(--quote-bg)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, marginLeft: 36 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--venice-blue)" }}>评论区预览</div>
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--rock-blue)" }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--venice-blue)" }}>{item.author}</div>
                <div style={{ fontSize: 9.5, padding: "2px 7px", borderRadius: 999, background: "var(--tag-bg)", color: "var(--venice-blue)", fontWeight: 700 }}>
                  来自 AI 助手采集
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-faint)" }}>{item.date}</div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(22,88,123,.85)" }}>{item.text}</div>
          </div>
        </div>
      );
  }
}

function dotStyle(opacity: number): CSSProperties {
  return { width: 6, height: 6, borderRadius: "50%", background: "var(--rock-blue)", opacity };
}

/**
 * PRD §6.3: the deferred post-stay question (入住体验) — AI推荐满意度 is asked
 * separately, immediately at booking time (see BookingSheet), not here. The
 * framing ("对了～你之前入住的『XX』…") and the actual question live in one
 * sentence, in one card, rather than a separate intro bubble followed by a
 * detached question box. Supports a tap-only quick answer plus an optional
 * "说得更细一点" composer (text / photo / voice); neither is required.
 */
function FollowupFlow({
  item,
  authorName,
  onDone,
}: {
  item: Extract<ChatItem, { kind: "followup-question" }>;
  authorName: string;
  onDone: (review: import("../types").Review | undefined) => void;
}) {
  const [done, setDone] = useState(false);
  const [log, setLog] = useState<{ id: string; label: string } | null>(null);

  function handleDone(label: string, review?: import("../types").Review) {
    setLog({ id: uid("fu-log"), label });
    setDone(true);
    onDone(review);
  }

  if (done) {
    return log ? (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ padding: "9px 13px", maxWidth: "78%", fontSize: 12.5, background: "var(--venice-blue)", color: "#fff", borderRadius: "14px 14px 4px 14px" }}>
          {log.label}
        </div>
      </div>
    ) : null;
  }

  return (
    <FeedbackQuestion
      kind="stay_experience"
      prompt={`对了～你之前入住的『${item.hotelName}』，住下来之后感觉干净吗？`}
      orderId={item.orderId}
      hotelId={item.hotelId}
      authorName={authorName}
      onDone={(label, review) => handleDone(label, review)}
    />
  );
}
