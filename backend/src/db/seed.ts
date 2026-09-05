/**
 * Loads REAL Ctrip/Trip.com hotel + review data (Kaggle dataset, see
 * ../../../data/dataset-metadata.json) — this is the product's only seed
 * source; the earlier hand-authored 15-hotel mock catalog was retired once
 * this real dataset was in hand.
 *
 * Every tag/amenity here is DERIVED from real fields in the dataset (sub-
 * ratings, travelType, room names, review text keyword mentions) rather
 * than hand-typed — see deriveReviewTopics/deriveHotelTags below. Two
 * exceptions, both flagged inline where they're used: base_price (the
 * dataset is a review scrape, not booking/inventory data, so price is still
 * a simulated placeholder per PRD §8) and REAL_IMAGE_URL_BY_HOTEL_ID (a
 * hand-verified Wikimedia Commons photo per hotel where one exists — see
 * that map's own comment for which hotel doesn't have one and why).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");

interface RawHotelSummary {
  hotelId: number;
  hotelName: string;
  hotelStars: number;
  hotelAddress: string;
}

interface RawReview {
  reviewId: string;
  hotelId: number;
  hotelName: string;
  submittedAt: string;
  reviewer: { ipLocation: string | null; tier: string | null };
  travelType: string;
  roomName: string | null;
  language: string;
  subRatings: string[]; // ["Cleanliness: 4.8", "Location: 4.8", ...]
  reviewText: string | null;
}

// Manually verified from hotelAddress / hotelName — the dataset has no
// clean "city" field of its own (addresses are free text).
const CITY_BY_HOTEL_ID: Record<number, string> = {
  344983: "澳门",
  1286148: "北京",
  1352621: "纽约",
  70492076: "杭州",
};

// Themed placeholder photo keywords per real hotel (see services/images.ts) —
// still a stand-in for actual property photos, but at least matched to the
// real property instead of a generic tag.
const PHOTO_QUERY_BY_HOTEL_ID: Record<number, string> = {
  344983: "macau,casino resort",
  1286148: "beijing,luxury hotel",
  1352621: "new york,city hotel",
  70492076: "hangzhou,luxury hotel",
};

// Hand-verified real photos (Wikimedia Commons, freely licensed — carry
// attribution if this app is ever shown outside the course). 洲至奢选杭州
// 华夏之心酒店 has no entry: it's a small IHG "Vignette Collection" property
// (opened 2020) with no Commons coverage found — it falls back to the
// LoremFlickr placeholder below rather than use an unlicensed official photo.
// Galaxy Hotel's photo is the whole Galaxy Macau resort exterior, not
// confirmed to be that exact tower specifically (the complex has 7+ hotel
// towers under different brands) — still the correct property/complex, just
// not guaranteed to be the precise building.
const REAL_IMAGE_URL_BY_HOTEL_ID: Record<number, string> = {
  344983: "https://commons.wikimedia.org/wiki/Special:FilePath/Galaxy_Macau.jpg?width=800",
  1286148: "https://commons.wikimedia.org/wiki/Special:FilePath/Sofitel%20Beijing%20Central%20(20231124161513).jpg?width=800",
  1352621: "https://commons.wikimedia.org/wiki/Special:FilePath/New%20York%20Hilton%20Midtown%20(55283614971).jpg?width=800",
};

// No price/inventory data in this dataset (it's a review scrape) — still
// simulated per PRD §8, picked to roughly match each property's real
// positioning (integrated resort / 5-star international chain / etc.).
const BASE_PRICE_BY_HOTEL_ID: Record<number, number> = {
  344983: 1280,
  1286148: 980,
  1352621: 1680,
  70492076: 1080,
};

const TRAVEL_TYPE_TO_TAG: Record<string, string> = {
  商务出差: "商务出行",
  "Business traveller": "商务出行",
  家庭亲子: "亲子友好",
  Family: "亲子友好",
  情侣出游: "情侣推荐",
  Couple: "情侣推荐",
  独自旅行: "独自旅行",
  "Solo traveller": "独自旅行",
  朋友出游: "朋友出游",
  "Travelling with friends": "朋友出游",
};

const AMENITY_KEYWORDS: Record<string, string> = {
  健身房: "gym",
  停车: "parking",
  早餐: "breakfast",
  泳池: "pool",
  游泳池: "pool",
};

function parseSubRatings(subRatings: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of subRatings) {
    const [label, val] = s.split(":").map((p) => p.trim());
    const num = Number(val);
    if (label && !Number.isNaN(num)) out[label] = num;
  }
  return out;
}

function deriveReviewTopics(review: RawReview): string[] {
  const topics = new Set<string>();
  const sub = parseSubRatings(review.subRatings ?? []);
  if (sub.Cleanliness >= 4.5) topics.add("干净");
  if (sub.Location >= 4.5) topics.add("位置好");
  if (sub.Service >= 4.5) topics.add("服务好");
  if (sub.Facilities >= 4.5) topics.add("设施好");

  const travelTag = TRAVEL_TYPE_TO_TAG[review.travelType ?? ""];
  if (travelTag) topics.add(travelTag);

  if (review.roomName && /大床|[Kk]ing/.test(review.roomName)) topics.add("大床房");

  return [...topics];
}

function deriveHotelTags(reviewTopics: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const topics of reviewTopics) {
    for (const t of topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const total = reviewTopics.length;
  const threshold = Math.max(5, Math.round(total * 0.15));
  // Cap at 8, not 5 — with these hotels averaging 4.5+ per sub-rating
  // dimension, 干净/位置好/服务好/设施好 clear the threshold on almost every
  // review and would otherwise crowd out the (more differentiating)
  // travel-type signal entirely.
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);
}

function deriveAmenities(reviewTexts: string[]): string[] {
  const amenities = new Set<string>(["wifi"]); // safe universal assumption for any modern hotel
  const joined = reviewTexts.join(" ");
  const counts = new Map<string, number>();
  for (const [keyword, amenity] of Object.entries(AMENITY_KEYWORDS)) {
    const count = joined.split(keyword).length - 1;
    counts.set(amenity, (counts.get(amenity) ?? 0) + count);
  }
  for (const [amenity, count] of counts) {
    if (count >= 2) amenities.add(amenity);
  }
  return [...amenities];
}

function authorLabel(reviewer: RawReview["reviewer"]): string {
  if (reviewer?.ipLocation) {
    const place = reviewer.ipLocation.replace("发布于", "").trim();
    if (place) return `${place}旅客`;
  }
  return reviewer?.tier || "匿名住客";
}

const DEMO_USER_PHONE = "13800000000";

function main() {
  const hotelSummaries: RawHotelSummary[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "hotel_summary.json"), "utf-8"));
  const allReviews: RawReview[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "reviews.json"), "utf-8"));

  // Only reviews whose ORIGINAL text is Chinese — this is a Chinese-facing
  // product; machine-translating the rest in would mix authentic voice with
  // translation artifacts, which defeats the point of testing on real text.
  const cnReviews = allReviews.filter((r) => (r.language === "zh" || r.language === "CN") && r.reviewText && r.reviewText.trim().length >= 5);

  const insertHotel = db.prepare(
    `INSERT INTO hotels (id, name, city, stars, base_price, tags, amenities, photo_query, real_image_url) VALUES (@id, @name, @city, @stars, @base_price, @tags, @amenities, @photo_query, @real_image_url)`
  );
  const insertReview = db.prepare(
    `INSERT INTO reviews (id, hotel_id, author, source, topics, text, created_at) VALUES (@id, @hotel_id, @author, @source, @topics, @text, @created_at)`
  );
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (id, phone, created_at) VALUES (@id, @phone, @created_at)`);
  const insertOrder = db.prepare(
    `INSERT INTO orders (id, user_id, hotel_id, checkin, checkout, guests, total_price, status, reviewed, source, chat_turns_before_order, created_at) VALUES (@id, @user_id, @hotel_id, @checkin, @checkout, @guests, @total_price, @status, @reviewed, @source, @chat_turns_before_order, @created_at)`
  );

  db.exec("DELETE FROM orders; DELETE FROM reviews; DELETE FROM hotels; DELETE FROM users;");

  const seedTx = db.transaction(() => {
    for (const h of hotelSummaries) {
      const hotelId = String(h.hotelId);
      const hotelReviews = cnReviews.filter((r) => r.hotelId === h.hotelId);
      const perReviewTopics = hotelReviews.map(deriveReviewTopics);

      insertHotel.run({
        id: hotelId,
        name: h.hotelName,
        city: CITY_BY_HOTEL_ID[h.hotelId] ?? "未知",
        stars: h.hotelStars,
        base_price: BASE_PRICE_BY_HOTEL_ID[h.hotelId] ?? 800,
        tags: JSON.stringify(deriveHotelTags(perReviewTopics)),
        amenities: JSON.stringify(deriveAmenities(hotelReviews.map((r) => r.reviewText ?? ""))),
        photo_query: PHOTO_QUERY_BY_HOTEL_ID[h.hotelId] ?? "hotel,room",
        real_image_url: REAL_IMAGE_URL_BY_HOTEL_ID[h.hotelId] ?? null,
      });

      hotelReviews.forEach((r, i) => {
        insertReview.run({
          id: r.reviewId,
          hotel_id: hotelId,
          author: authorLabel(r.reviewer),
          source: "user",
          topics: JSON.stringify(perReviewTopics[i]),
          text: r.reviewText!.trim(),
          created_at: r.submittedAt,
        });
      });

      console.log(`  ${h.hotelName}: ${hotelReviews.length} 条真实中文评论, 标签=${deriveHotelTags(perReviewTopics).join("/") || "(无)"}`);
    }

    const userId = "ctrip-demo-user";
    insertUser.run({ id: userId, phone: DEMO_USER_PHONE, created_at: new Date().toISOString() });

    // Same follow-up-flywheel demo setup as the mock seed: one completed,
    // not-yet-reviewed order against a real hotel (北京索菲特大酒店).
    insertOrder.run({
      id: "ctrip-demo-order-1",
      user_id: userId,
      hotel_id: "1286148",
      checkin: "2026-08-20",
      checkout: "2026-08-22",
      guests: 2,
      total_price: 1960,
      status: "completed",
      reviewed: 0,
      source: "manual_filter", // it's a seeded historical order for testing 6.3, not a real AI-chat conversion — kept out of the adoption-rate stats
      chat_turns_before_order: null,
      created_at: "2026-08-22T10:00:00.000Z",
    });
  });
  seedTx();

  console.log(`\nSeeded ${hotelSummaries.length} real hotels, ${cnReviews.length} real Chinese reviews, demo user ${DEMO_USER_PHONE}.`);
}

main();
