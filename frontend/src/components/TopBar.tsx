import { useState } from "react";
import type { User } from "../types";

export type Mode = "chat" | "filter";

export function TopBar({
  mode,
  onModeChange,
  user,
  onAvatarClick,
  onLogout,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  user: User | null;
  onAvatarClick: () => void;
  onLogout: () => void;
}) {
  // Tap the avatar to reveal a logout button, tap that to actually log out —
  // matches the familiar "tap avatar, then confirm the action" pattern
  // instead of a single tap silently logging out.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "16px 16px 0",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--venice-blue)" }}>出发喽</div>
        <button
          onClick={() => (user ? setMenuOpen((v) => !v) : onAvatarClick())}
          aria-label={user ? `已登录：${user.phone}，点击查看退出选项` : "登录"}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--rock-blue)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(22,88,123,.18)",
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </button>

        {menuOpen && user && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setMenuOpen(false)} />
            <button
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
              style={{
                position: "absolute",
                top: 42,
                right: 0,
                zIndex: 40,
                background: "var(--merino)",
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(22,88,123,.2)",
                padding: "9px 16px",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
                color: "#b3462c",
                whiteSpace: "nowrap",
              }}
            >
              退出登录
            </button>
          </>
        )}
      </div>

      <div
        role="tablist"
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          background: "rgba(255,255,255,.6)",
          borderRadius: 999,
          padding: 4,
          gap: 2,
          boxShadow: "0 1px 4px rgba(22,88,123,.08)",
        }}
      >
        {(["chat", "filter"] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => onModeChange(m)}
            style={{
              padding: "8px 18px",
              borderRadius: 999,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              background: mode === m ? "var(--venice-blue)" : "transparent",
              color: mode === m ? "#fff" : "var(--venice-blue)",
              opacity: mode === m ? 1 : 0.65,
              transition: "background .2s, color .2s",
            }}
          >
            {m === "chat" ? "AI推荐" : "手动筛选"}
          </button>
        ))}
      </div>
    </header>
  );
}
