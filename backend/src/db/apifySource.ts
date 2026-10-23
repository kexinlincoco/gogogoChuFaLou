/**
 * data/apify-data 的数据源定义：7 家北京酒店的清单，以及单条评论的处理规则
 * （评论 ID、话题标签、作者名）。seed.ts（全量重建）和
 * scripts/import-english-reviews.ts（增量导入）共用这里，保证两种方式
 * 得到的评论 ID 和内容完全一致——标准答案（eval/level1/gold）按评论 ID 对应。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APIFY_DATA_DIR = path.join(__dirname, "..", "..", "..", "data", "apify-data");

/** 不需要翻译、直接导入的语言（中文、英文；I-26）。其他语言要在译文文件里有中文译文才导入（T2.5）。 */
export const IMPORTED_LANGUAGES = ["zh", "en"];

/** 其他语言评论的中文译文（scripts/translate-reviews.ts 生成），按评论 ID 索引。 */
export const TRANSLATIONS_FILE = path.join(__dirname, "..", "..", "..", "data", "apify-translations.json");
export interface Translation {
  language: string;
  zh: string;
  model: string;
  translatedAt: string;
}
export function loadTranslations(): Record<string, Translation> {
  return fs.existsSync(TRANSLATIONS_FILE) ? JSON.parse(fs.readFileSync(TRANSLATIONS_FILE, "utf-8")) : {};
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
export interface RawApifyReview {
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

export interface ApifyHotelManifestEntry {
  file: string;
  hotelId: string;
  name: string;
  stars: number;
  base_price: number;
  photo_query: string;
}

// Positioning (stars/base_price) is a placeholder judgment call from each
// brand's known market tier — see file-level comment; the dataset itself
// carries no stars/price. City is Beijing for all seven (source folder is
// Beijing-only).
export const APIFY_HOTELS: ApifyHotelManifestEntry[] = [
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

export function deriveApifyReviewTopics(review: RawApifyReview): string[] {
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

export function cleanApifyNickname(raw: string | null): string {
  // The scraper interleaves U+200D zero-width joiners between every letter
  // of already-public display names (anti-scraping artifact, not extra
  // anonymization) — stripping them just recovers the plain text the
  // platform itself displays.
  const cleaned = (raw ?? "").replace(/‍/g, "").trim();
  return cleaned || "匿名住客";
}

export function isImportableApifyReview(r: RawApifyReview, translations: Record<string, Translation> = {}): boolean {
  if (!r.content || r.content.trim().length < 5) return false;
  return IMPORTED_LANGUAGES.includes(r.language) || !!translations[`apify-${r.id}`];
}

/** 一条 Apify 评论写进 reviews 表的那一行（seed 和增量导入用同一个函数）。 */
export function apifyReviewRow(hotelId: string, r: RawApifyReview, translations: Record<string, Translation> = {}) {
  const t = translations[`apify-${r.id}`];
  return {
    id: `apify-${r.id}`,
    hotel_id: hotelId,
    author: cleanApifyNickname(r.userNickName),
    source: "user" as const,
    topics: JSON.stringify(deriveApifyReviewTopics(r)),
    text: r.content!.trim(),
    created_at: r.createDate.replace(" ", "T"),
    language: r.language,
    translation: IMPORTED_LANGUAGES.includes(r.language) ? null : (t?.zh ?? null),
  };
}
