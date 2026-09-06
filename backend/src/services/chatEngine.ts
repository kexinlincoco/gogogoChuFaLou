import type { ChatMessage } from "../types.js";
import type { Hotel } from "../types.js";
import { listCities, listHotels } from "../db/repo.js";
import { retrieveEvidence } from "./retrieval.js";
import {
  EMPTY_SLOTS,
  Slots,
  askForMissingSlot,
  extractSlots,
  generateRecommendationReasons,
  introduceRecommendations,
  hasApiKey,
} from "./ai.js";

interface Session {
  history: ChatMessage[];
  slots: Slots;
  userName?: string;
  // Index into `history` where the current, not-yet-answered ask begins —
  // moved to the end of history once a recommendation is actually shown
  // (see handleTurn). extractSlots uses history[slotsResetIndex:] as the
  // ONLY source for prefer/avoid, so a preference from an ask that already
  // got its cards doesn't keep silently steering a later, different ask;
  // sticky fields (city/checkin/budget/...) still see the full history.
  slotsResetIndex: number;
}

const sessions = new Map<string, Session>();

function getSession(sessionId: string): Session {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { history: [], slots: { ...EMPTY_SLOTS }, slotsResetIndex: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

const REQUIRED_FIELDS = ["city", "checkin", "checkout", "budget_max"] as const;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fillDerivedFields(slots: Slots): Slots {
  const next = { ...slots };
  if (next.checkin && !next.checkout && next.nights) {
    next.checkout = addDays(next.checkin, next.nights);
  }
  if (!next.guests) next.guests = 2; // PRD §6.1: 默认2人1间, doesn't block required-field check
  return next;
}

function missingRequired(slots: Slots): string[] {
  return REQUIRED_FIELDS.filter((f) => slots[f] === null || slots[f] === undefined);
}

export interface HotelCandidate {
  hotel: Hotel;
  reason: string;
  matchedSnippets: { author: string; text: string }[];
  matchRatioPct: number;
}

export type ChatTurnResult =
  | { type: "ask"; reply: string; slots: Slots }
  | { type: "recommend"; reply: string; slots: Slots; hotels: HotelCandidate[] }
  | { type: "error"; reply: string };

function scoreHotel(hotel: Hotel, slots: Slots): number {
  const preferHits = slots.prefer.filter((p) => hotel.tags.includes(p)).length;
  const avoidHits = slots.avoid.filter((a) => hotel.tags.some((t) => t.includes(a) || a.includes(t))).length;
  const budgetPenalty = slots.budget_max ? Math.abs(hotel.base_price - slots.budget_max) / 100 : 0;
  return preferHits * 10 - avoidHits * 20 - budgetPenalty;
}

interface MatchResult {
  hotels: Hotel[];
  cityCovered: boolean; // false = the requested city has zero hotels in our dataset
}

function matchHotels(slots: Slots): MatchResult {
  const wantedCity = slots.city ?? undefined;

  // Never silently swap in a different city — try city+budget first, then
  // relax the budget (keep the city), and only fall back across ALL cities
  // when the city itself genuinely isn't in the dataset. The caller must
  // tell the user honestly when that last case happens (see handleTurn).
  let pool = listHotels({
    city: wantedCity,
    priceMax: slots.budget_max ? Math.round(slots.budget_max * 1.3) : undefined,
  });
  if (pool.length === 0 && wantedCity) {
    pool = listHotels({ city: wantedCity });
  }
  const cityCovered = !wantedCity || pool.length > 0;
  if (pool.length === 0) {
    pool = listHotels({});
  }

  const hotels = pool
    .map((h) => ({ h, score: scoreHotel(h, slots) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.h);
  return { hotels, cityCovered };
}

export async function handleTurn(sessionId: string, userText: string, userName?: string): Promise<ChatTurnResult> {
  if (!hasApiKey()) {
    return {
      type: "error",
      reply: "AI 对话功能还没配置好——后端缺少 OPENAI_API_KEY，请在 backend/.env 里配置后重启服务。",
    };
  }

  const session = getSession(sessionId);
  if (userName) session.userName = userName; // sticky for the session once known
  session.history.push({ role: "user", text: userText });

  try {
    const recentHistory = session.history.slice(session.slotsResetIndex);
    const extracted = await extractSlots(session.history, recentHistory, session.slots);
    session.slots = fillDerivedFields(extracted);

    const missing = missingRequired(session.slots);
    if (missing.length > 0) {
      const reply = await askForMissingSlot(session.history, session.slots, missing, session.userName);
      session.history.push({ role: "assistant", text: reply });
      return { type: "ask", reply, slots: session.slots };
    }

    const { hotels: matched, cityCovered } = matchHotels(session.slots);
    const evidenceByHotel = matched.map((hotel) => ({ hotel, evidence: retrieveEvidence(hotel.id, session.slots.prefer) }));
    const [introRaw, reasons] = await Promise.all([
      cityCovered ? introduceRecommendations(session.history, session.slots, session.userName) : Promise.resolve(null),
      generateRecommendationReasons(session.slots, evidenceByHotel),
    ]);
    const intro =
      introRaw ??
      `我们的酒店库目前只覆盖${listCities().join("、")}这几个城市，还没有${session.slots.city}的数据——先给你看看其他城市里口碑不错的酒店，你也可以换一个城市试试～`;

    const hotels: HotelCandidate[] = evidenceByHotel.map(({ hotel, evidence }) => ({
      hotel,
      reason: reasons[hotel.id] ?? "这家酒店的真实住客评价也还不错。",
      matchedSnippets: evidence.matched.map((r) => ({ author: r.author, text: r.text })),
      matchRatioPct: Math.round(evidence.matchRatio * 100),
    }));

    session.history.push({ role: "assistant", text: intro });
    // This ask is answered — the next user message starts a fresh one, so
    // its prefer/avoid must come only from what's said after this point.
    session.slotsResetIndex = session.history.length;
    return { type: "recommend", reply: intro, slots: session.slots, hotels };
  } catch (err) {
    console.error("[chatEngine] turn failed", err);
    return { type: "error", reply: "抱歉，AI 暂时没能理解，可以再说一次你的想法吗？" };
  }
}

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** How many user messages this chat session sent so far — the raw signal
 * behind "下单前用了几轮对话" (PRD §10). Looked up server-side at order
 * creation time so it can't be spoofed from the client; a session that was
 * never seen (or already got reset) returns null rather than 0, so it's
 * distinguishable from "genuinely placed the order on the first message". */
export function getUserTurnCount(sessionId: string): number | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return s.history.filter((m) => m.role === "user").length;
}
