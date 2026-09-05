import { useState, type CSSProperties } from "react";
import { api } from "../api/client";
import type { User } from "../types";

const DEMO_PHONE = "13800000000";

export function LoginModal({ onSuccess, onCancel }: { onSuccess: (user: User) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once login succeeds for a brand-new phone number (no name on file
  // yet) — the modal then asks for a name before finishing, instead of
  // asking up front for every visitor regardless of whether they log in.
  const [nameless, setNameless] = useState<User | null>(null);
  const [nameInput, setNameInput] = useState("");

  async function requestCode() {
    setError(null);
    if (!/^1\d{10}$/.test(phone)) {
      setError("请输入正确的手机号");
      return;
    }
    setBusy(true);
    try {
      const r = await api.requestCode(phone);
      setCodeSent(true);
      setDevCode(r.devCode); // MVP mock SMS: no real message is sent, so we surface the dev code here
    } catch {
      setError("获取验证码失败");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.login(phone, code);
      if (r.user.name) {
        onSuccess(r.user);
      } else {
        setNameless(r.user);
      }
    } catch {
      setError("验证码不对，再试试？");
    } finally {
      setBusy(false);
    }
  }

  async function submitName() {
    if (!nameInput.trim()) return;
    setError(null);
    setBusy(true);
    try {
      // Same login call, now carrying the name — the backend only fills it
      // in because this account doesn't have one yet (see routes/auth.ts).
      const r = await api.login(phone, code, nameInput.trim());
      onSuccess(r.user);
    } catch {
      setError("提交失败，再试试？");
    } finally {
      setBusy(false);
    }
  }

  function useDemoAccount() {
    setPhone(DEMO_PHONE);
    setCodeSent(true);
    setDevCode("123456");
    setCode("123456");
  }

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(15,40,55,.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 340, background: "var(--merino)", borderRadius: 20, padding: "24px 22px", boxShadow: "0 20px 50px rgba(15,66,92,.3)", display: "flex", flexDirection: "column", gap: 12 }}
      >
        {nameless ? (
          <>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--venice-blue)" }}>怎么称呼你？</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>第一次用这个手机号，之后每次登录都会记得这个名字，不用再填一次。</div>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
              }}
              placeholder="输入你的名字或昵称"
              maxLength={20}
              style={inputStyle}
            />
            {error && <div style={{ fontSize: 12, color: "#b3462c" }}>{error}</div>}
            <button onClick={submitName} disabled={busy || !nameInput.trim()} style={primaryBtn}>
              确定
            </button>
          </>
        ) : (
          <>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--venice-blue)" }}>登录 / 注册</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>用手机号登录，浏览和聊天不需要登录。</div>

            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="手机号"
              inputMode="numeric"
              style={inputStyle}
            />

            {codeSent && (
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="验证码" inputMode="numeric" style={inputStyle} />
            )}
            {devCode && <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>模拟短信：验证码是 {devCode}（未接入真实短信网关）</div>}
            {error && <div style={{ fontSize: 12, color: "#b3462c" }}>{error}</div>}

            {!codeSent ? (
              <button onClick={requestCode} disabled={busy} style={primaryBtn}>
                获取验证码
              </button>
            ) : (
              <button onClick={submit} disabled={busy || code.length === 0} style={primaryBtn}>
                登录
              </button>
            )}

            <button onClick={useDemoAccount} style={{ fontSize: 11.5, color: "var(--venice-blue)", background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}>
              使用 demo 账号（{DEMO_PHONE}）快速体验
            </button>

            <button onClick={onCancel} style={{ fontSize: 12, color: "var(--ink-faint)", background: "none", border: "none", cursor: "pointer" }}>
              取消
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "11px 13px",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
};
const primaryBtn: CSSProperties = {
  background: "var(--venice-blue)",
  color: "#fff",
  border: "none",
  borderRadius: 14,
  padding: "12px 0",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
