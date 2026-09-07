import { Router } from "express";
import { listCities, listTags, listHotels, getHotel, getReviewsForHotel, topReviewTopics } from "../db/repo.js";
import { nightlyPrice, totalPrice } from "../services/pricing.js";
import { keywordMatchesTag } from "../lib/textMatch.js";

export const hotelsRouter = Router();

function parseList(v: unknown): string[] | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

hotelsRouter.get("/cities", (_req, res) => {
  res.json({ cities: listCities() });
});

hotelsRouter.get("/tags", (_req, res) => {
  res.json({ tags: listTags() });
});

hotelsRouter.get("/", (req, res) => {
  const { city, priceMin, priceMax, stars, amenities, tags, sort } = req.query;
  const starList = parseList(stars)?.map(Number);
  const amenityList = parseList(amenities);
  const tagList = parseList(tags);

  let hotels = listHotels({
    city: typeof city === "string" && city ? city : undefined,
    priceMin: priceMin ? Number(priceMin) : undefined,
    priceMax: priceMax ? Number(priceMax) : undefined,
    stars: starList,
    amenities: amenityList,
    tags: tagList,
  });

  if (sort === "price") {
    hotels = [...hotels].sort((a, b) => a.base_price - b.base_price);
  } else if (sort === "stars") {
    hotels = [...hotels].sort((a, b) => b.stars - a.stars);
  }

  const withMeta = hotels.map((h) => ({
    ...h,
    reviewCount: getReviewsForHotel(h.id).length,
    samplePrice: nightlyPrice(h.id, h.base_price, new Date().toISOString().slice(0, 10)),
  }));

  res.json({ count: withMeta.length, hotels: withMeta });
});

hotelsRouter.get("/:id", (req, res) => {
  const hotel = getHotel(req.params.id);
  if (!hotel) return res.status(404).json({ error: "hotel_not_found" });

  const { checkin, checkout, prefer } = req.query;
  let reviews = getReviewsForHotel(hotel.id);

  // When the caller knows what the user actually asked for (passed down from
  // the chat recommendation that led here), surface matching reviews first —
  // ranked by HOW MANY of the prefer keywords each review really backs (topic
  // tag OR literal text match, same two-way check as retrieveEvidence — a
  // topic-less need like "安静" still counts if it's actually written), not
  // just a binary match/no-match. Stable sort, so relevance re-orders without
  // scrambling recency within each same-score group. Manual-filter entry has
  // no such context, so this is a no-op there and the highlight below is the
  // only signal shown.
  const preferList = parseList(prefer);
  if (preferList && preferList.length > 0) {
    const matchCount = (r: (typeof reviews)[number]) => preferList.filter((p) => r.topics.some((t) => keywordMatchesTag(p, t)) || r.text.includes(p)).length;
    reviews = [...reviews].sort((a, b) => matchCount(b) - matchCount(a));
  }

  let price: { nightly: number; total: number; nights: number } | null = null;
  if (typeof checkin === "string" && typeof checkout === "string") {
    const nights = Math.max(1, Math.round((new Date(checkout).getTime() - new Date(checkin).getTime()) / 86_400_000));
    price = {
      nightly: nightlyPrice(hotel.id, hotel.base_price, checkin),
      total: totalPrice(hotel.id, hotel.base_price, checkin, checkout),
      nights,
    };
  }

  res.json({ hotel, reviews, price, reviewHighlights: topReviewTopics(hotel.id, preferList ?? []) });
});
