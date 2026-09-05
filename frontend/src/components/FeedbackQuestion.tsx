import { useRef, useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import type { Review } from "../types";
import { AIAvatar } from "./AIAvatar";

const STAY_CHOICE_LABEL: Record<"clean" | "ok" | "dirty" | "skip", string> = {
  clean: "很干净",
  ok: "一般",
  dirty: "不太干净",
  skip: "先跳过",
};
const STAY_CHOICE_REPLY: Record<"clean" | "ok" | "dirty", string> = {
  clean: "挺干净的，浴室用品也齐全～",
  ok: "还行吧，基本干净。",
  dirty: "有点不太干净，希望下次能改善。",
};
const SATISFACTION_CHOICE_LABEL: Record<"satisfied" | "neutral" | "unsatisfied" | "skip", string> = {
  satisfied: "满意",
  neutral: "一般",
  unsatisfied: "不满意",
  skip: "先跳过",
};
const SATISFACTION_CHOICE_REPLY: Record<"satisfied" | "neutral" | "unsatisfied", string> = {
  satisfied: "这次AI推荐的还挺合我心意的～",
  neutral: "还行吧，凑合能接受。",
  unsatisfied: "说实话不太满意，感觉没推荐到点子上。",
};

const MAX_DETAIL_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_RECORD_MS = 30_000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Shared by both post-order feedback moments — "AI推荐满意度" (asked
 * immediately on the booking-success screen, BookingSheet.tsx) and "入住体验"
 * (asked later via chat once the stay is over, ChatScreen.tsx's
 * FollowupFlow) — so both get the same tap-only quick answer, optional
 * "说得更细一点" composer (text/photo/voice), and the same publish-consent
 * choice, instead of two different, drifting implementations.
 */
export function FeedbackQuestion({
  kind,
  prompt,
  orderId,
  hotelId,
  authorName,
  onDone,
}: {
  kind: "satisfaction" | "stay_experience";
  prompt: string;
  orderId: string;
  hotelId: string;
  authorName: string;
  onDone: (label: string, review?: Review) => void;
}) {
  const CHOICE_LABEL = kind === "satisfaction" ? SATISFACTION_CHOICE_LABEL : STAY_CHOICE_LABEL;
  const CHOICE_REPLY = kind === "satisfaction" ? SATISFACTION_CHOICE_REPLY : STAY_CHOICE_REPLY;
  const choices = kind === "satisfaction" ? (["satisfied", "neutral", "unsatisfied", "skip"] as const) : (["clean", "ok", "dirty", "skip"] as const);

  const [choice, setChoice] = useState<string | null>(null);
  const [detailText, setDetailText] = useState("");
  const [detailImage, setDetailImage] = useState<string | null>(null);
  const [detailAudio, setDetailAudio] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  // Default to sharing publicly — matches how review sites normally work
  // (public unless you opt out) — the toggle lets anyone dial that back.
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function pickChoice(c: string) {
    if (c === "skip") {
      setSubmitting(true);
      await api.followupAnswer({ orderId, hotelId, kind, choice: "skip" });
      onDone((CHOICE_LABEL as Record<string, string>).skip);
      return;
    }
    setChoice(c);
  }

  async function submitDetail() {
    if (!choice) return;
    setSubmitting(true);
    setError(null);
    try {
      const { review } = await api.followupAnswer({
        orderId,
        hotelId,
        kind,
        choice,
        authorName,
        detailText: detailText.trim() || undefined,
        detailImage: detailImage ?? undefined,
        detailAudio: detailAudio ?? undefined,
        visible,
      });
      const label = detailText.trim() || (CHOICE_REPLY as Record<string, string>)[choice] || (CHOICE_LABEL as Record<string, string>)[choice];
      onDone(label, review);
    } catch {
      setError("提交失败，再试试？");
      setSubmitting(false);
    }
  }

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_DETAIL_IMAGE_BYTES) {
      setError("这张图片有点大，换一张小一点的试试？");
      return;
    }
    fileToDataUrl(file)
      .then(setDetailImage)
      .catch(() => setError("图片读取失败，要不换一张？"));
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => setDetailAudio(reader.result as string);
        reader.readAsDataURL(blob);
        setRecording(false);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      recordTimerRef.current = setTimeout(() => recorder.stop(), MAX_RECORD_MS);
    } catch {
      setError("没能获取麦克风权限，要不打字说说？");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <AIAvatar size={28} />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px 16px 16px 4px",
          padding: "11px 14px",
          maxWidth: "78%",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)" }}>{prompt}</div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {choices.map((c) => (
          <button
            key={c}
            disabled={submitting || (!!choice && choice !== c)}
            onClick={() => pickChoice(c)}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: submitting ? "default" : "pointer",
              border: "none",
              background: choice === c ? "var(--venice-blue)" : "rgba(132,179,206,.25)",
              color: choice === c ? "#fff" : "var(--venice-blue)",
              opacity: choice && choice !== c ? 0.5 : 1,
            }}
          >
            {(CHOICE_LABEL as Record<string, string>)[c]}
          </button>
        ))}
      </div>

      {choice && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>想再说说细节吗？（可选，文字/照片/语音都行）</div>
          <textarea
            value={detailText}
            onChange={(e) => setDetailText(e.target.value)}
            placeholder="打字说说…"
            rows={2}
            style={{ resize: "none", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, color: "var(--ink)", background: "var(--merino)", font: "inherit", outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 999, background: "rgba(132,179,206,.2)", color: "var(--venice-blue)", cursor: "pointer" }}>
              {detailImage ? "已添加照片 ✓" : "添加照片"}
              <input type="file" accept="image/*" onChange={onPickImage} style={{ display: "none" }} />
            </label>
            <button
              onClick={toggleRecording}
              type="button"
              style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 999, border: "none", cursor: "pointer", background: recording ? "#b3462c" : "rgba(132,179,206,.2)", color: recording ? "#fff" : "var(--venice-blue)" }}
            >
              {recording ? "录音中…点击结束" : detailAudio ? "已录音 ✓（点击重录）" : "按此录音"}
            </button>
            {detailImage && (
              <img src={detailImage} alt="预览" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
            )}
            {detailAudio && !recording && <audio src={detailAudio} controls style={{ height: 28, maxWidth: 160 }} />}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--ink-soft)", cursor: "pointer" }}>
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} style={{ margin: 0 }} />
            同意展示在评论区给其他旅客参考（不同意的话，我们仍会记录你的反馈，只是不会公开展示）
          </label>

          {error && <div style={{ fontSize: 11, color: "#b3462c" }}>{error}</div>}
          <button
            onClick={submitDetail}
            disabled={submitting}
            style={{ alignSelf: "flex-end", padding: "7px 16px", borderRadius: 999, border: "none", background: "var(--venice-blue)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "提交中…" : "提交"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
