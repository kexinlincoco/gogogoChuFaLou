# Trip.com & Ctrip (携程) Hotel Reviews — Sample (2026)

A clean, ready-to-analyze sample of **800 public hotel reviews** across four hotels, captured in **both locales**:
**200 international reviews from Trip.com** (Galaxy Hotel, Macau) and **600 Chinese-language reviews from Ctrip /
携程** (Sofitel Beijing, New York Hilton Midtown, and a luxury Hangzhou hotel). Each review carries per-dimension
**sub-ratings**, **hotel owner responses**, the reviewer's **Chinese province of origin** (Ctrip), travel type, and an
**LLM-ready `markdownContent`** field.

Extracted with the [Trip.com & Ctrip Reviews Scraper](https://apify.com/factden/ctrip-trip-reviews-scraper?fpr=factden)
on Apify. This is a curated sample — [run the actor](https://apify.com/factden/ctrip-trip-reviews-scraper?fpr=factden)
for any hotel on either platform, at any scale.

## Files

| File | Rows | What |
|---|---|---|
| `reviews.csv` / `reviews.json` / `reviews.jsonl` | 800 | One row per review, 23 fields |
| `hotel_summary.csv` / `hotel_summary.json` | 4 | Per-hotel metadata + aggregates (rating, sub-ratings, owner-response rate, top reviewer provinces) |

`.jsonl` suits ML/RAG loading; `.csv` suits spreadsheets/Kaggle; `.json` for general use. In JSON/JSONL the
**`reviewer`** and **`ownerResponse`** fields are nested objects and **`subRatings`** is an array; in CSV they are
flattened to `reviewer_*` / `ownerResponse_*` columns and `subRatings` is joined into one cell (e.g.
`Cleanliness: 4.8; Location: 4.8; Service: 4.8; Facilities: 4.8`).

## What makes this interesting

**One platform, two audiences.** Ctrip (携程) carries the Chinese-domestic guest voice; Trip.com carries the
international one. The same actor reads both, so you can compare how each audience rates and what they care about.

**Chinese guests reviewing a New York hotel.** The New York Hilton Midtown rows are **200 Chinese-language Ctrip
reviews of a US property** — including **40 reviews posted from the USA** (`reviewer.ipLocation = 发布于美国`). It is
also the lowest-rated hotel in the set (4.0/5, with Service 3.9 and Facilities 3.7), a useful contrast to the 4.6–4.8
ratings elsewhere.

**Owner-response culture varies sharply.** In this sample, Galaxy Macau replied to **100%** of reviews and the Beijing
and Hangzhou hotels to **~99%** — but the New York Hilton replied to **0%** of its Ctrip reviews. `ownerResponse` (and
`ownerResponseRateInSample` in the hotel summary) make that visible.

**Province-level Chinese geography.** `reviewer.ipLocation` is populated on **87% of Ctrip rows**. Top origins in this
sample: Zhejiang, Beijing, Shanghai, **USA**, Guangdong — province-level segmentation no English-only scraper exposes.

| Hotel | Source | Avg rating | Owner-response rate (sample) | Top reviewer origins |
|---|---|---|---|---|
| Galaxy Hotel, Macau | Trip.com | 4.8 | 100% | (Trip.com has no IP location) |
| Sofitel Beijing | Ctrip | 4.6 | 99% | Beijing, Guangdong, Liaoning |
| New York Hilton Midtown | Ctrip | 4.0 | 0% | USA, Shanghai, Beijing |
| Hangzhou (luxury) | Ctrip | 4.7 | 99% | Zhejiang, Shanghai, Jiangsu |

Reviews span **2023-06 → 2026-06**. Travel mix skews business on Ctrip (商务出差) and family on Trip.com.

## Field dictionary (reviews)

| Field | Type | Notes |
|---|---|---|
| `reviewId` | string | Unique review id |
| `hotelId` / `hotelName` / `hotelUrl` | int / string / string | Hotel identity (id is shared across Trip.com & Ctrip) |
| `source` | string | `trip` (Trip.com) or `ctrip` (Ctrip / 携程) |
| `submittedAt` / `checkInMonth` | string | Submission time (hotel-local, naive ISO) / check-in month `YYYY-MM` |
| `reviewer` | object | `{ name, lifetimeReviews, tier, isAnonymous, ipLocation }` — `ipLocation` is the Chinese province (Ctrip only); CSV: `reviewer_*` columns |
| `travelType` | string | Business / Family / Couple / Solo / Friends / Other (localized on Ctrip) |
| `roomName` | string | Room type booked |
| `language` | string | ISO code of the original review text |
| `overallRating` / `ratingLabel` | number / string | 0–5 rating + localized tier label |
| `subRatings` | array | Labeled sub-ratings, e.g. `["Cleanliness: 4.8", "Location: 4.8", ...]`; CSV: one joined cell |
| `reviewText` / `reviewTextTranslated` / `isMachineTranslated` | string / string / bool | Original text, platform machine-translation (when present), and the flag |
| `recommends` | bool | Whether the guest recommends the hotel |
| `usefulCount` / `imagesCount` / `hasVideo` | int / int / bool | Engagement + media signals |
| `ownerResponse` | object \| null | `{ text, date }` hotel-management reply, or null; CSV: `ownerResponse_*` columns |
| `markdownContent` | string | **LLM-ready** self-contained markdown block — drop straight into a RAG pipeline |

`hotel_summary` adds per hotel: `hotelStars`, `hotelAddress`, aggregate `overallRating` + `subRatings`,
`reviewsCount`, `reviewsInSample`, `ownerResponseRateInSample`, `recommendRate`, `negativeReviewsCount`,
`topReviewerProvinces`.

### Fields intentionally omitted (kept clean)
The actor's full schema also emits `extractedAt` (scrape timestamp), dropped here for signal. Everything else from the
live output is preserved. Full schema: the [actor's developer
repo](https://github.com/factden/ctrip-trip-reviews-scraper).

## Methodology
- Collected from **publicly accessible** Trip.com and Ctrip hotel-review pages via the
  [Trip.com & Ctrip Reviews Scraper](https://apify.com/factden/ctrip-trip-reviews-scraper?fpr=factden).
- 200 reviews per hotel, most-recent first. Sample date: 2026-06. No rows synthesized; values are real public reviews.

## Source & usage
The reviews are **public content authored by Trip.com / Ctrip users**; all trademarks and content belong to their
respective owners. This sample is shared **for research, education, and demonstration** of structured review
extraction. It is **not affiliated with or endorsed by Trip.com Group, Ctrip, or any hotel.** Chinese-language text and
`reviewer.ipLocation` are reproduced as published; ensure your downstream use complies with GDPR, China's PIPL, and
other applicable regulations. Verify any conclusions against the linked hotel pages.

## Get the full data
This is a 4-hotel, 800-row sample. To pull reviews for **any** Trip.com or Ctrip hotel — all fields, sub-ratings,
owner responses, province-level origin, and LLM-ready markdown — run the actor:

**▶ [Trip.com & Ctrip Reviews Scraper on Apify →](https://apify.com/factden/ctrip-trip-reviews-scraper?fpr=factden)**

More free tools and samples at **[factden.com](https://factden.com)**.
