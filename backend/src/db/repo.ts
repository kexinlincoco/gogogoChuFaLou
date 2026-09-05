import { nanoid } from "nanoid";
import { db } from "./client.js";
import { buildImageUrl } from "../services/images.js";
import type { Hotel, HotelRow, Review, ReviewRow, Order, OrderFeedback, BookingFunnelEvent, User } from "../types.js";

function rowToHotel(row: HotelRow): Hotel {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    stars: row.stars,
    base_price: row.base_price,
    tags: JSON.parse(row.tags),
    amenities: JSON.parse(row.amenities),
    imageUrl: row.real_image_url || buildImageUrl(row.photo_query, row.id),
  };
}

function rowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    hotel_id: row.hotel_id,
    author: row.author,
    source: row.source,
    topics: JSON.parse(row.topics),
    text: row.text,
    created_at: row.created_at,
  };
}

export interface HotelFilter {
  city?: string;
  priceMin?: number;
  priceMax?: number;
  stars?: number[];
  amenities?: string[];
  tags?: string[]; // preference tags (海景房/安静/亲子友好/...) — OR semantics, see listHotels
}

export function listCities(): string[] {
  const rows = db.prepare(`SELECT DISTINCT city FROM hotels ORDER BY city`).all() as { city: string }[];
  return rows.map((r) => r.city);
}

export function listTags(): string[] {
  const rows = db.prepare(`SELECT tags FROM hotels`).all() as { tags: string }[];
  const set = new Set<string>();
  for (const row of rows) {
    for (const t of JSON.parse(row.tags) as string[]) set.add(t);
  }
  return [...set].sort();
}

export function listHotels(filter: HotelFilter = {}): Hotel[] {
  const rows = db.prepare(`SELECT * FROM hotels`).all() as HotelRow[];
  let hotels = rows.map(rowToHotel);

  if (filter.city) {
    hotels = hotels.filter((h) => h.city === filter.city);
  }
  if (filter.stars && filter.stars.length > 0) {
    hotels = hotels.filter((h) => filter.stars!.includes(h.stars));
  }
  if (filter.amenities && filter.amenities.length > 0) {
    hotels = hotels.filter((h) => filter.amenities!.every((a) => h.amenities.includes(a)));
  }
  if (filter.tags && filter.tags.length > 0) {
    // OR, not AND: each hotel only carries 1-2 tags, so "must have every
    // selected tag" would empty the results as soon as 2+ are picked.
    hotels = hotels.filter((h) => filter.tags!.some((t) => h.tags.includes(t)));
  }
  if (filter.priceMin !== undefined) {
    hotels = hotels.filter((h) => h.base_price >= filter.priceMin!);
  }
  if (filter.priceMax !== undefined) {
    hotels = hotels.filter((h) => h.base_price <= filter.priceMax!);
  }
  return hotels;
}

export function getHotel(id: string): Hotel | null {
  const row = db.prepare(`SELECT * FROM hotels WHERE id = ?`).get(id) as HotelRow | undefined;
  return row ? rowToHotel(row) : null;
}

export function getHotelsByIds(ids: string[]): Hotel[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM hotels WHERE id IN (${placeholders})`).all(...ids) as HotelRow[];
  const byId = new Map(rows.map((r) => [r.id, rowToHotel(r)]));
  return ids.map((id) => byId.get(id)).filter((h): h is Hotel => !!h);
}

export function getReviewsForHotel(hotelId: string): Review[] {
  const rows = db.prepare(`SELECT * FROM reviews WHERE hotel_id = ? ORDER BY created_at DESC`).all(hotelId) as ReviewRow[];
  return rows.map(rowToReview);
}

export interface ReviewHighlight {
  topic: string;
  count: number;
  total: number;
  pct: number;
}

/** The single most-mentioned topic across all of a hotel's reviews (not
 * limited to whatever the user happened to ask for) — a "at a glance" trust
 * signal that works even when there's no chat context to prioritize by. */
export function topReviewTopic(hotelId: string): ReviewHighlight | null {
  const reviews = getReviewsForHotel(hotelId);
  if (reviews.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of reviews) {
    for (const t of r.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const [topic, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { topic, count, total: reviews.length, pct: Math.round((count / reviews.length) * 100) };
}

export function insertAiCollectedReview(review: Omit<Review, "id" | "created_at">): Review {
  const id = nanoid(10);
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO reviews (id, hotel_id, author, source, topics, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, review.hotel_id, review.author, review.source, JSON.stringify(review.topics), review.text, created_at);
  return { ...review, id, created_at };
}

export function findUserByPhone(phone: string): User | null {
  const row = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone) as User | undefined;
  return row ?? null;
}

export function createUser(phone: string, name: string | null = null): User {
  const id = nanoid(10);
  const created_at = new Date().toISOString();
  db.prepare(`INSERT INTO users (id, phone, name, created_at) VALUES (?, ?, ?, ?)`).run(id, phone, name, created_at);
  return { id, phone, name, created_at };
}

/** Only fills in a name if the account doesn't already have one — an
 * existing account's locked-in name always wins over a same-session local
 * nickname (see schema.sql). */
export function setUserNameIfMissing(userId: string, name: string): User {
  db.prepare(`UPDATE users SET name = ? WHERE id = ? AND name IS NULL`).run(name, userId);
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User;
  return row;
}

export function createOrder(
  order: Omit<Order, "id" | "created_at" | "reviewed" | "status">
): Order {
  const id = nanoid(10);
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO orders (id, user_id, hotel_id, checkin, checkout, guests, total_price, status, reviewed, source, chat_turns_before_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 0, ?, ?, ?)`
  ).run(
    id,
    order.user_id,
    order.hotel_id,
    order.checkin,
    order.checkout,
    order.guests,
    order.total_price,
    order.source,
    order.chat_turns_before_order ?? null,
    created_at
  );
  return { ...order, id, status: "completed", reviewed: 0, created_at };
}

/** Only orders whose stay has actually finished are eligible for the
 * PRD §6.3 follow-up ("怎么问是基于'已经住完'的历史订单，而不是刚下单就问") —
 * a freshly-placed real order with future dates won't surface here until its
 * checkout date has passed. The seeded demo order already has a past
 * checkout date, so it keeps working with no special-casing.
 *
 * When several past stays are eligible at once, ask about the most recently
 * checked-out one first (ORDER BY checkout DESC) — that stay is freshest in
 * the user's memory, so the answer is both easier for them to give and more
 * useful to future customers than digging up an older, half-remembered one. */
export function findPendingFollowupOrder(userId: string): Order | null {
  const row = db
    .prepare(
      `SELECT * FROM orders WHERE user_id = ? AND status = 'completed' AND reviewed = 0 AND checkout <= date('now') ORDER BY checkout DESC LIMIT 1`
    )
    .get(userId) as Order | undefined;
  return row ?? null;
}

export function markOrderReviewed(orderId: string): void {
  db.prepare(`UPDATE orders SET reviewed = 1 WHERE id = ?`).run(orderId);
}

export function getOrder(orderId: string): Order | null {
  const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Order | undefined;
  return row ?? null;
}

export function insertOrderFeedback(feedback: Omit<OrderFeedback, "id" | "created_at">): OrderFeedback {
  const id = nanoid(10);
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO order_feedback (id, order_id, kind, choice, detail_text, detail_image, detail_audio, visible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    feedback.order_id,
    feedback.kind,
    feedback.choice,
    feedback.detail_text ?? null,
    feedback.detail_image ?? null,
    feedback.detail_audio ?? null,
    feedback.visible,
    created_at
  );
  return { ...feedback, id, created_at };
}

export function insertFunnelEvent(event: Omit<BookingFunnelEvent, "id" | "created_at">): BookingFunnelEvent {
  const id = nanoid(10);
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO booking_funnel_events (id, hotel_id, session_id, source, stage, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, event.hotel_id, event.session_id ?? null, event.source, event.stage, created_at);
  return { ...event, id, created_at };
}

export interface MetricsSummary {
  totalOrders: number;
  aiChatOrders: number;
  manualOrders: number;
  adoptionRatePct: number | null; // aiChatOrders / totalOrders, null when there are no orders yet
  avgChatTurnsForAiOrders: number | null;
  satisfaction: { satisfied: number; neutral: number; unsatisfied: number; skipped: number; totalAnswered: number };
  stayExperience: { clean: number; ok: number; dirty: number; skipped: number; totalAnswered: number };
  funnel: { sheetOpened: number; confirmClicked: number; paymentCompleted: number };
}

export function getMetricsSummary(): MetricsSummary {
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM orders`).get() as { total: number };
  const { aiChat } = db.prepare(`SELECT COUNT(*) AS aiChat FROM orders WHERE source = 'ai_chat'`).get() as { aiChat: number };
  const { avgTurns } = db
    .prepare(`SELECT AVG(chat_turns_before_order) AS avgTurns FROM orders WHERE source = 'ai_chat' AND chat_turns_before_order IS NOT NULL`)
    .get() as { avgTurns: number | null };

  // Scoped to source='ai_chat' — manual-filter orders now also collect a
  // "satisfaction" answer (see BookingSheet), but the PRD §10 "推荐满意度"
  // metric is specifically about AI recommendation quality, so it stays
  // restricted to orders that actually came from an AI recommendation.
  const satisfactionRows = db
    .prepare(
      `SELECT f.choice, COUNT(*) AS n FROM order_feedback f
       JOIN orders o ON o.id = f.order_id
       WHERE f.kind = 'satisfaction' AND o.source = 'ai_chat'
       GROUP BY f.choice`
    )
    .all() as { choice: string; n: number }[];
  const stayRows = db
    .prepare(`SELECT choice, COUNT(*) AS n FROM order_feedback WHERE kind = 'stay_experience' GROUP BY choice`)
    .all() as { choice: string; n: number }[];

  const countFor = (rows: { choice: string; n: number }[], choice: string) => rows.find((r) => r.choice === choice)?.n ?? 0;
  const satisfaction = {
    satisfied: countFor(satisfactionRows, "satisfied"),
    neutral: countFor(satisfactionRows, "neutral"),
    unsatisfied: countFor(satisfactionRows, "unsatisfied"),
    skipped: countFor(satisfactionRows, "skip"),
    totalAnswered: satisfactionRows.reduce((sum, r) => sum + r.n, 0),
  };
  const stayExperience = {
    clean: countFor(stayRows, "clean"),
    ok: countFor(stayRows, "ok"),
    dirty: countFor(stayRows, "dirty"),
    skipped: countFor(stayRows, "skip"),
    totalAnswered: stayRows.reduce((sum, r) => sum + r.n, 0),
  };

  const funnelRows = db
    .prepare(`SELECT stage, COUNT(*) AS n FROM booking_funnel_events GROUP BY stage`)
    .all() as { stage: string; n: number }[];
  const countStage = (stage: string) => funnelRows.find((r) => r.stage === stage)?.n ?? 0;
  const funnel = {
    sheetOpened: countStage("sheet_opened"),
    confirmClicked: countStage("confirm_clicked"),
    paymentCompleted: countStage("payment_completed"),
  };

  return {
    totalOrders: total,
    aiChatOrders: aiChat,
    manualOrders: total - aiChat,
    adoptionRatePct: total > 0 ? Math.round((aiChat / total) * 1000) / 10 : null,
    avgChatTurnsForAiOrders: avgTurns !== null ? Math.round(avgTurns * 10) / 10 : null,
    satisfaction,
    stayExperience,
    funnel,
  };
}
