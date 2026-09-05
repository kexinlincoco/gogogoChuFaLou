export interface Hotel {
  id: string;
  name: string;
  city: string;
  stars: number;
  base_price: number;
  tags: string[];
  amenities: string[];
  imageUrl: string;
  reviewCount?: number;
  samplePrice?: number;
}

export interface Review {
  id: string;
  hotel_id: string;
  author: string;
  source: "user" | "ai_collected";
  topics: string[];
  text: string;
  created_at: string;
}

export interface User {
  id: string;
  phone: string;
  name: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  user_id: string;
  hotel_id: string;
  checkin: string;
  checkout: string;
  guests: number;
  total_price: number;
  status: string;
  reviewed: number;
  source: "ai_chat" | "manual_filter";
  chat_turns_before_order: number | null;
  created_at: string;
}

export interface MetricsSummary {
  totalOrders: number;
  aiChatOrders: number;
  manualOrders: number;
  adoptionRatePct: number | null;
  avgChatTurnsForAiOrders: number | null;
  satisfaction: { satisfied: number; neutral: number; unsatisfied: number; skipped: number; totalAnswered: number };
  stayExperience: { clean: number; ok: number; dirty: number; skipped: number; totalAnswered: number };
  funnel: { sheetOpened: number; confirmClicked: number; paymentCompleted: number };
}

export interface HotelCandidate {
  hotel: Hotel;
  reason: string;
  matchedSnippets: { author: string; text: string }[];
  matchRatioPct: number;
}

export interface ReviewHighlight {
  topic: string;
  count: number;
  total: number;
  pct: number;
}

export interface Slots {
  city: string | null;
  checkin: string | null;
  checkout: string | null;
  nights: number | null;
  budget_max: number | null;
  guests: number | null;
  prefer: string[];
  avoid: string[];
}

export type ChatTurnResult =
  | { type: "ask"; reply: string; slots: Slots }
  | { type: "recommend"; reply: string; slots: Slots; hotels: HotelCandidate[] }
  | { type: "error"; reply: string };

export type ChatItem =
  | { kind: "ai-text"; id: string; text: string }
  | { kind: "user-text"; id: string; text: string }
  | { kind: "typing"; id: string }
  | { kind: "hotel-cards"; id: string; hotels: HotelCandidate[]; prefer: string[] }
  | { kind: "quickfills"; id: string; prompts: string[] }
  | {
      kind: "followup-question";
      id: string;
      orderId: string;
      hotelId: string;
      hotelName: string;
    }
  | { kind: "review-preview"; id: string; author: string; text: string; date: string };
