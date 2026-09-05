import { useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import type { Order, User } from "./types";
import { TopBar, type Mode } from "./components/TopBar";
import { ChatScreen } from "./components/ChatScreen";
import { FilterScreen } from "./components/FilterScreen";
import { BookingSheet } from "./components/BookingSheet";
import { LoginModal } from "./components/LoginModal";
import { MetricsDebugPage } from "./components/MetricsDebugPage";

const SESSION_KEY = "chufalou.sessionId";
const USER_KEY = "chufalou.user";
const NAME_KEY = "chufalou.userName";

function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("chat");
  const [sessionId, setSessionId] = useState(getOrCreateSessionId);
  const [userName, setUserName] = useState<string | null>(() => localStorage.getItem(NAME_KEY));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  });
  const [openHotelId, setOpenHotelId] = useState<string | null>(null);
  const [openHotelPrefer, setOpenHotelPrefer] = useState<string[] | undefined>(undefined);
  const [openHotelSource, setOpenHotelSource] = useState<"ai_chat" | "manual_filter">("manual_filter");
  const [showLogin, setShowLogin] = useState(false);
  const [backendWarning, setBackendWarning] = useState<string | null>(null);

  const loginWaiterRef = useRef<{ resolve: (u: User) => void; reject: () => void } | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        if (!h.aiConfigured) {
          setBackendWarning("后端还没配置 OPENAI_API_KEY，AI 聊天暂时不可用，其他功能不受影响。");
        }
      })
      .catch(() => setBackendWarning("连不上后端服务，请确认 backend 已启动（npm run dev）。"));
  }, []);

  function persistUser(u: User) {
    setUser(u);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    // The account's locked-in name (set on its first-ever login) always wins
    // over whatever local nickname is currently active — a returning phone
    // number should be greeted by its own remembered name, not the nickname
    // someone else typed into NameGate this session.
    if (u.name) {
      setUserName(u.name);
      localStorage.setItem(NAME_KEY, u.name);
    }
  }

  function logout() {
    setUser(null);
    localStorage.removeItem(USER_KEY);
    // Name and account are the same identity now — logging out clears both,
    // so the next login re-asks for a name (or, for a returning phone
    // number, gets greeted by its own remembered name; see persistUser).
    setUserName(null);
    localStorage.removeItem(NAME_KEY);
    // A fresh chat session too — otherwise logging in again still shows the
    // previous person's conversation and the AI's extracted slots/context
    // (city, budget, prefs) leak across accounts. Old session is cleaned up
    // server-side on a best-effort basis (fire-and-forget).
    api.resetChat(sessionId).catch(() => {});
    const newSessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, newSessionId);
    setSessionId(newSessionId);
    // Straight back to the login page, not silently back to anonymous
    // browsing — makes it obvious the logout worked and invites signing
    // back in right away.
    setShowLogin(true);
  }

  function requireLogin(): Promise<User> {
    setShowLogin(true);
    return new Promise((resolve, reject) => {
      loginWaiterRef.current = { resolve, reject };
    });
  }

  async function confirmAndPay(input: { hotelId: string; checkin: string; checkout: string; guests: number }): Promise<Order> {
    const activeUser = user ?? (await requireLogin());
    const { order } = await api.createOrder({ userId: activeUser.id, ...input, source: openHotelSource, sessionId });
    return order;
  }

  function openHotel(hotelId: string, prefer?: string[], source: "ai_chat" | "manual_filter" = "manual_filter") {
    setOpenHotelId(hotelId);
    setOpenHotelPrefer(prefer);
    setOpenHotelSource(source);
  }

  if (new URLSearchParams(window.location.search).get("debug") === "metrics") {
    return <MetricsDebugPage />;
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "radial-gradient(120% 90% at 20% 0%, #DCE9EF 0%, #EFE6D2 45%, #F5EEDD 100%)",
      }}
    >
      <TopBar mode={mode} onModeChange={setMode} user={user} onAvatarClick={() => setShowLogin(true)} onLogout={logout} />

      {backendWarning && (
        <div style={{ margin: "8px 16px 0", padding: "8px 12px", borderRadius: 10, background: "rgba(179,70,44,.12)", color: "#b3462c", fontSize: 11.5 }}>
          {backendWarning}
        </div>
      )}

      {/* Both screens stay mounted so switching modes never loses chat history
          or in-progress filter state (PRD 6.4: "无缝衔接，不是两个割裂功能") */}
      <div style={{ flex: 1, minHeight: 0, display: mode === "chat" ? "flex" : "none", flexDirection: "column" }}>
        <ChatScreen key={sessionId} sessionId={sessionId} user={user} userName={userName} onOpenHotel={openHotel} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: mode === "filter" ? "flex" : "none", flexDirection: "column" }}>
        <FilterScreen onOpenHotel={openHotel} onAskAi={() => setMode("chat")} />
      </div>

      {openHotelId && (
        <BookingSheet
          hotelId={openHotelId}
          prefer={openHotelPrefer}
          sessionId={sessionId}
          source={openHotelSource}
          authorName={user?.phone ? "我" : "匿名住客"}
          onClose={() => setOpenHotelId(null)}
          confirmAndPay={confirmAndPay}
        />
      )}

      {showLogin && (
        <LoginModal
          onSuccess={(u) => {
            persistUser(u);
            setShowLogin(false);
            loginWaiterRef.current?.resolve(u);
            loginWaiterRef.current = null;
          }}
          onCancel={() => {
            setShowLogin(false);
            loginWaiterRef.current?.reject();
            loginWaiterRef.current = null;
          }}
        />
      )}
    </div>
  );
}
