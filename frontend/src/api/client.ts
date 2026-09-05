import type { ChatTurnResult, Hotel, MetricsSummary, Order, Review, ReviewHighlight, User } from "../types";

// Empty by default: frontend and backend share one origin (see backend/src/index.ts
// production static-serving), so a relative /api/... path just works. Set
// VITE_API_BASE_URL only when the frontend is deployed separately from the backend
// (e.g. frontend on Vercel, backend on Render) — point it at the backend's full URL,
// no trailing slash (e.g. https://chufalou-backend.onrender.com).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; aiConfigured: boolean }>("/health"),

  cities: () => request<{ cities: string[] }>("/hotels/cities"),

  tags: () => request<{ tags: string[] }>("/hotels/tags"),

  listHotels: (params: {
    city?: string;
    priceMin?: number;
    priceMax?: number;
    stars?: number[];
    amenities?: string[];
    tags?: string[];
    sort?: "price" | "stars";
  }) => {
    const qs = new URLSearchParams();
    if (params.city) qs.set("city", params.city);
    if (params.priceMin !== undefined) qs.set("priceMin", String(params.priceMin));
    if (params.priceMax !== undefined) qs.set("priceMax", String(params.priceMax));
    if (params.stars?.length) qs.set("stars", params.stars.join(","));
    if (params.amenities?.length) qs.set("amenities", params.amenities.join(","));
    if (params.tags?.length) qs.set("tags", params.tags.join(","));
    if (params.sort) qs.set("sort", params.sort);
    return request<{ count: number; hotels: Hotel[] }>(`/hotels?${qs.toString()}`);
  },

  getHotel: (id: string, checkin?: string, checkout?: string, prefer?: string[]) => {
    const qs = new URLSearchParams();
    if (checkin) qs.set("checkin", checkin);
    if (checkout) qs.set("checkout", checkout);
    if (prefer?.length) qs.set("prefer", prefer.join(","));
    return request<{
      hotel: Hotel;
      reviews: Review[];
      price: { nightly: number; total: number; nights: number } | null;
      reviewHighlight: ReviewHighlight | null;
    }>(`/hotels/${id}?${qs.toString()}`);
  },

  requestCode: (phone: string) => request<{ ok: boolean; devCode: string }>("/auth/request-code", { method: "POST", body: JSON.stringify({ phone }) }),

  login: (phone: string, code: string, name?: string) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ phone, code, name }) }),

  createOrder: (input: {
    userId: string;
    hotelId: string;
    checkin: string;
    checkout: string;
    guests: number;
    source: "ai_chat" | "manual_filter";
    sessionId?: string;
  }) => request<{ order: Order; hotel: Hotel }>("/orders", { method: "POST", body: JSON.stringify(input) }),

  listOrders: (userId: string) => request<{ orders: Order[] }>(`/orders?userId=${userId}`),

  followupPending: (userId: string) => request<{ pending: { order: Order; hotel: Hotel } | null }>(`/followup/pending?userId=${userId}`),

  followupAnswer: (input: {
    orderId: string;
    hotelId: string;
    kind: "satisfaction" | "stay_experience";
    choice: string;
    authorName?: string;
    detailText?: string;
    detailImage?: string;
    detailAudio?: string;
    visible?: boolean;
  }) => request<{ skipped?: true; review?: Review; hotel?: Hotel }>("/followup/answer", { method: "POST", body: JSON.stringify(input) }),

  sendChatMessage: (sessionId: string, text: string, userName?: string) =>
    request<ChatTurnResult>("/chat/message", { method: "POST", body: JSON.stringify({ sessionId, text, userName }) }),

  resetChat: (sessionId: string) => request<{ ok: boolean }>("/chat/reset", { method: "POST", body: JSON.stringify({ sessionId }) }),

  metrics: () => request<MetricsSummary>("/metrics"),

  // Fire-and-forget funnel instrumentation (PRD §10) — never blocks or
  // throws into the booking flow if it fails.
  logFunnelEvent: (input: {
    hotelId: string;
    sessionId?: string;
    source: "ai_chat" | "manual_filter";
    stage: "sheet_opened" | "confirm_clicked" | "payment_completed";
  }) =>
    request<{ ok: boolean }>("/funnel-events", { method: "POST", body: JSON.stringify(input) }).catch(() => {
      /* instrumentation only, swallow errors */
    }),
};
