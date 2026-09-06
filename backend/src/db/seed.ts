/**
 * Loads REAL hotel + review data from two scraped sources — this is the
 * product's only seed data; the earlier hand-authored 15-hotel mock catalog
 * was retired once real datasets were in hand:
 *
 * 1. Ctrip/Trip.com sample (Kaggle dataset, see ../../../data/dataset-
 *    metadata.json): 4 hotels in Macau/Beijing/New York/Hangzhou.
 * 2. data/apify-data/*.json: 7 more Beijing hotels (incl. three hutong/
 *    siheyuan courtyard properties), scraped directly per-hotel — added
 *    later to widen the soft-preference test surface (四合院/胡同/泳池/亲子
 *    all have real supporting review text in this batch, see
 *    deriveApifyReviewTopics below).
 *
 * Every tag/amenity here is DERIVED from real fields in the dataset (sub-
 * ratings, travelType, room names, review text keyword mentions) rather
 * than hand-typed — see deriveReviewTopics/deriveHotelTags and
 * deriveApifyReviewTopics below. Exceptions, flagged inline where used:
 * base_price and stars for the apify-data hotels (that dataset is a review
 * scrape with no per-hotel metadata file, so both are placeholders picked
 * to roughly match each property's real market positioning, per PRD §8),
 * and the two REAL_IMAGE_URL_BY_*_ID maps (hand-verified real photos — see
 * each map's own comment for source/licensing per hotel; any hotel with no
 * entry falls back to the photo_query placeholder).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");
const APIFY_DATA_DIR = path.join(DATA_DIR, "apify-data");

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

// ---------------------------------------------------------------------------
// data/apify-data/*.json — 7 more Beijing hotels, one file per hotel, no
// hotel-level metadata file (unlike the Kaggle dataset above), so hotel
// identity/positioning is hand-supplied here from the platform's own
// hotelId + the filename. Field shapes differ from RawReview (this is a
// different scraper): `content` not `reviewText`, `travelTypeText` in
// English, `rating` on a 0–10 scale, no per-review sub-ratings (only a
// hotel-level aggregate repeated on every row — used for tags, not
// per-review topics, so it never overstates how many reviews actually
// mention it).
// ---------------------------------------------------------------------------
interface RawApifyReview {
  id: number;
  language: string;
  content: string | null;
  createDate: string;
  rating: number; // 0-10
  travelTypeText: string | null;
  roomTypeName: string | null;
  userNickName: string | null;
  hotelId: string;
  aggregateReviewSubScore: { name: string; score: number }[];
}

interface ApifyHotelManifestEntry {
  file: string;
  hotelId: string;
  name: string;
  stars: number;
  base_price: number;
  photo_query: string;
}

// Hand-verified real photos. Checked one-by-one against each specific
// property (fetched the actual listing page, confirmed the image genuinely
// shows that hotel — branding visible in-shot for 4 of these 7) rather than
// guessed. Two source types, deliberately kept apart:
// - Wikimedia Commons (CC BY-SA 4.0, freely licensed, safe to redistribute):
//   only 2 of the 7 apify-data hotels had any coverage at all.
// - Trip.com's own CDN (ak-d.tripcdn.com): the other 5 are small independent
//   boutique/budget properties with zero Commons coverage, so these are the
//   hotel-submitted photos from the SAME Trip.com listing this dataset's
//   reviews were scraped from (see data/README.md) — i.e. sourced from the
//   platform this data already comes from, not a random web image. These
//   are hotel/platform copyrighted content, not freely licensed like the
//   Commons ones, and this CDN has no hotlink protection today but could
//   add it or reorganize URLs later — a real tradeoff, made knowingly here
//   rather than silently.
const REAL_IMAGE_URL_BY_APIFY_HOTEL_ID: Record<string, string> = {
  // Novotel Beijing Peace: a side building of the hotel (built 1952 for the
  // Asia & Pacific Rim Peace Conference) — confirmed to be this property.
  "385117": "https://commons.wikimedia.org/wiki/Special:FilePath/Side%20building%20of%20Novotel%20Beijing%20Peace%20(20220908154932).jpg?width=800",
  // Kerry Hotel Beijing: exterior of the Beijing Kerry Centre complex at
  // the hotel's Guanghua Road address — same caveat as Galaxy Macau above,
  // this is the mixed-use complex the hotel occupies, not confirmed to be
  // the exact hotel tower/entrance.
  "347422": "https://commons.wikimedia.org/wiki/Special:FilePath/Beijing%20Kerry%20Centre.jpg?width=800",
  // HanTing Hotel (Qianmen St): exterior with the 汉庭酒店 sign clearly
  // visible — from the hotel's own Trip.com listing (hotelId matches).
  "130505294": "https://ak-d.tripcdn.com/images/1mc5l12000mtw1gyg2EBF_R_960_660_R5_D.jpg",
  // Renaissance Beijing Capital Hotel: tower exterior with "Renaissance"
  // branding visible on the building.
  "374778": "https://ak-d.tripcdn.com/images/1mc4j12000knhc98t5013_R_960_660_R5_D.jpg",
  // Peking Yard Siheyuan: entrance with the "Peking Yard" sign visible.
  "5237880": "https://ak-d.tripcdn.com/images/1mc2712000m6kdoxi69D8_R_960_660_R5_D.jpg",
  // Ancient City Old Courtyard: the property's own courtyard/architecture.
  "2086765": "https://ak-d.tripcdn.com/images/20080p000000fym040A8C_R_960_660_R5_D.jpg",
  // Forbidden City Hutong Courtyard International Hotel: the property's own
  // hutong-style courtyard corridor.
  "822126": "https://ak-d.tripcdn.com/images/0204212000sotmz4dD32C_R_960_660_R5_D.jpg",
};

// Positioning (stars/base_price) is a placeholder judgment call from each
// brand's known market tier — see file-level comment; the dataset itself
// carries no stars/price. City is Beijing for all seven (source folder is
// Beijing-only).
const APIFY_HOTELS: ApifyHotelManifestEntry[] = [
  {
    file: "HanTing_Hotel_(Qianmen St).json",
    hotelId: "130505294",
    name: "汉庭酒店(前门店)",
    stars: 3,
    base_price: 320,
    photo_query: "beijing,budget hotel room",
  },
  {
    file: "Novotel_Beijing_Peace.json",
    hotelId: "385117",
    name: "诺富特北京和平宾馆",
    stars: 4,
    base_price: 680,
    photo_query: "beijing,business hotel",
  },
  {
    file: "Kerry_Hotel_Beijing(北京嘉里大酒店).json",
    hotelId: "347422",
    name: "北京嘉里大酒店",
    stars: 5,
    base_price: 1580,
    photo_query: "beijing,luxury hotel pool",
  },
  {
    file: "Renaissance_Beijing_Capital_Hotel.json",
    hotelId: "374778",
    name: "Renaissance Beijing Capital Hotel",
    stars: 5,
    base_price: 1380,
    photo_query: "beijing,upscale hotel",
  },
  {
    file: "Peking_Yard_Siheyuan.json",
    hotelId: "5237880",
    name: "北平大院四合院客栈",
    stars: 3,
    base_price: 580,
    photo_query: "beijing,siheyuan courtyard",
  },
  {
    file: "Ancient_City_Old_Courtyard(Cours et Pavillons).json",
    hotelId: "2086765",
    name: "古城老院子客栈",
    stars: 3,
    base_price: 520,
    photo_query: "beijing,hutong courtyard",
  },
  {
    file: "Forbidden_City_Hutong_Courtyard_International Hotel.json",
    hotelId: "822126",
    name: "皇城根胡同四合院国际酒店",
    stars: 3,
    base_price: 560,
    photo_query: "beijing,hutong courtyard hotel",
  },
];

const APIFY_TRAVEL_TYPE_TO_TAG: Record<string, string> = {
  "Business traveler": "商务出行",
  Family: "亲子友好",
  Couple: "情侣推荐",
  "Solo traveler": "独自旅行",
  "Traveling with friends": "朋友出游",
};

// Only categories with real supporting text in this dataset (checked
// against the actual review corpus, see PR notes) — no "安静"/"海景" here
// because those strings simply don't occur in these 962 reviews, and this
// codebase's whole point is to never fabricate a match.
const APIFY_TEXT_KEYWORD_TO_TAG: [RegExp, string][] = [
  [/四合院/, "四合院"],
  [/胡同/, "胡同"],
  [/游泳池|泳池/, "泳池"],
  [/健身房/, "健身房"],
  [/早餐/, "早餐好"],
  [/性价比|划算/, "性价比"],
  [/位置好|地段好|位置|地段/, "位置好"],
  [/交通方便|交通便利|地铁/, "近地铁"],
  [/孩子|小孩|带娃/, "亲子友好"],
];

function deriveApifyReviewTopics(review: RawApifyReview): string[] {
  const topics = new Set<string>();
  const text = review.content ?? "";
  for (const [re, tag] of APIFY_TEXT_KEYWORD_TO_TAG) {
    if (re.test(text)) topics.add(tag);
  }
  const travelTag = APIFY_TRAVEL_TYPE_TO_TAG[review.travelTypeText ?? ""];
  if (travelTag) topics.add(travelTag);
  if (review.roomTypeName && /大床|[Kk]ing/.test(review.roomTypeName)) topics.add("大床房");
  return [...topics];
}

// Hotel-level quality tags from the dataset's own aggregate sub-scores
// (0-10 scale, same figure repeated on every row for that hotel — a real
// platform-computed stat, not sampled from just our downloaded reviews).
// Kept OUT of per-review topics/deriveApifyReviewTopics on purpose: adding
// it to every single review would make retrieveEvidence "match" reviews
// that never actually mention cleanliness/service, which is exactly the
// kind of fabricated evidence this app's RAG design avoids elsewhere.
function deriveApifyHotelQualityTags(subScores: { name: string; score: number }[]): string[] {
  const byName = new Map(subScores.map((s) => [s.name, s.score]));
  const tags: string[] = [];
  if ((byName.get("Cleanliness") ?? 0) >= 9.5) tags.push("干净");
  if ((byName.get("Location") ?? 0) >= 9.5) tags.push("位置好");
  if ((byName.get("Service") ?? 0) >= 9.5) tags.push("服务好");
  if ((byName.get("Amenities") ?? 0) >= 9.3) tags.push("设施好");
  return tags;
}

function cleanApifyNickname(raw: string | null): string {
  // The scraper interleaves U+200D zero-width joiners between every letter
  // of already-public display names (anti-scraping artifact, not extra
  // anonymization) — stripping them just recovers the plain text the
  // platform itself displays.
  const cleaned = (raw ?? "").replace(/‍/g, "").trim();
  return cleaned || "匿名住客";
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

  // order_feedback/booking_funnel_events both FK-reference orders/hotels, so
  // they must go first — a backup of whatever was in these three tables
  // before a reseed lives in backend/data/pre-reseed-backup-*.json (gitignored,
  // made by hand before running this script) since this wipe is otherwise
  // unrecoverable demo/test data, not sample content re-derived from data/.
  db.exec("DELETE FROM order_feedback; DELETE FROM booking_funnel_events; DELETE FROM orders; DELETE FROM reviews; DELETE FROM hotels; DELETE FROM users;");

  let apifyReviewCount = 0;

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

    for (const entry of APIFY_HOTELS) {
      const raw: RawApifyReview[] = JSON.parse(fs.readFileSync(path.join(APIFY_DATA_DIR, entry.file), "utf-8"));
      const hotelReviews = raw.filter((r) => r.language === "zh" && r.content && r.content.trim().length >= 5);
      const perReviewTopics = hotelReviews.map(deriveApifyReviewTopics);
      const textTags = deriveHotelTags(perReviewTopics);
      const qualityTags = deriveApifyHotelQualityTags(raw[0]?.aggregateReviewSubScore ?? []);
      const tags = [...textTags, ...qualityTags.filter((t) => !textTags.includes(t))].slice(0, 8);

      insertHotel.run({
        id: entry.hotelId,
        name: entry.name,
        city: "北京",
        stars: entry.stars,
        base_price: entry.base_price,
        tags: JSON.stringify(tags),
        amenities: JSON.stringify(deriveAmenities(hotelReviews.map((r) => r.content ?? ""))),
        photo_query: entry.photo_query,
        real_image_url: REAL_IMAGE_URL_BY_APIFY_HOTEL_ID[entry.hotelId] ?? null,
      });

      hotelReviews.forEach((r, i) => {
        insertReview.run({
          id: `apify-${r.id}`,
          hotel_id: entry.hotelId,
          author: cleanApifyNickname(r.userNickName),
          source: "user",
          topics: JSON.stringify(perReviewTopics[i]),
          text: r.content!.trim(),
          created_at: r.createDate.replace(" ", "T"),
        });
      });

      apifyReviewCount += hotelReviews.length;
      console.log(`  ${entry.name}: ${hotelReviews.length} 条真实中文评论, 标签=${tags.join("/") || "(无)"}`);
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

  console.log(
    `\nSeeded ${hotelSummaries.length + APIFY_HOTELS.length} real hotels ` +
      `(${cnReviews.length} + ${apifyReviewCount} = ${cnReviews.length + apifyReviewCount} real Chinese reviews), demo user ${DEMO_USER_PHONE}.`
  );
}

main();
