export interface Hotel {
  id: string;
  name: string;
  city: string;
  stars: number;
  base_price: number;
  tags: string[];
  amenities: string[];
  imageUrl: string;
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

export interface HotelRow {
  id: string;
  name: string;
  city: string;
  stars: number;
  base_price: number;
  tags: string; // raw JSON string as stored
  amenities: string;
  photo_query: string;
  real_image_url: string | null;
}

export interface ReviewRow {
  id: string;
  hotel_id: string;
  author: string;
  source: "user" | "ai_collected";
  topics: string;
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

export interface OrderFeedback {
  id: string;
  order_id: string;
  kind: "satisfaction" | "stay_experience";
  choice: string;
  detail_text: string | null;
  detail_image: string | null;
  detail_audio: string | null;
  visible: number; // 1 = user consented to publish this as a review, 0 = recorded only
  created_at: string;
}

export interface BookingFunnelEvent {
  id: string;
  hotel_id: string;
  session_id: string | null;
  source: "ai_chat" | "manual_filter";
  stage: "sheet_opened" | "confirm_clicked" | "payment_completed";
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

// ChatSession.slots is typed by services/ai.ts's Slots (zod-inferred) —
// imported where sessions are constructed, kept out of this file to avoid a
// second, driftable definition of the same shape.
export interface ChatSession<TSlots = unknown> {
  id: string;
  history: ChatMessage[];
  slots: TSlots;
}
