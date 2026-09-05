import { Router } from "express";
import { findPendingFollowupOrder, getHotel, insertAiCollectedReview, insertOrderFeedback, markOrderReviewed } from "../db/repo.js";

export const followupRouter = Router();

// PRD §6.3 / §12: structured quick-reply choices for the tap-only path, never
// free text required — the optional detail fields below are additive, not a
// replacement (see "低反馈人群" note in the PRD).
const STAY_CHOICE_TEXT: Record<string, string> = {
  clean: "挺干净的，浴室用品也齐全～",
  ok: "还行吧，基本干净。",
  dirty: "有点不太干净，希望下次能改善。",
};
// Matches the frontend's SATISFACTION_CHOICE_REPLY copy — kept in sync so a
// satisfaction answer reads like a real (if brief) review sentence, not a
// raw label, when it lands in the reviews table (see below).
const SATISFACTION_CHOICE_TEXT: Record<string, string> = {
  satisfied: "这次AI推荐的还挺合我心意的～",
  neutral: "还行吧，凑合能接受。",
  unsatisfied: "说实话不太满意，感觉没推荐到点子上。",
};

// A small, deliberately shallow keyword scan — just enough to tag a
// free-text elaboration with the same topic vocabulary real reviews use
// (see backend/src/db/seed.ts's AMENITY_KEYWORDS), so it can also surface
// through "住客高频提到" / evidence retrieval. Not NLP, just substring match.
const TOPIC_KEYWORDS: Record<string, string[]> = {
  干净: ["干净", "卫生", "整洁"],
  服务好: ["服务", "热情", "态度"],
  位置好: ["位置", "地铁", "交通", "市中心"],
  设施好: ["设施", "设备", "装修"],
  早餐: ["早餐", "自助餐"],
  停车: ["停车", "车位"],
  健身房: ["健身房", "健身"],
};

function deriveTopicsFromText(text: string | undefined | null, fallback: string[]): string[] {
  if (!text || !text.trim()) return fallback;
  const found = Object.entries(TOPIC_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => text.includes(k)))
    .map(([topic]) => topic);
  return found.length > 0 ? found : fallback;
}

followupRouter.get("/pending", (req, res) => {
  const { userId } = req.query;
  if (typeof userId !== "string") return res.status(400).json({ error: "missing_userId" });

  const order = findPendingFollowupOrder(userId);
  if (!order) return res.json({ pending: null });

  const hotel = getHotel(order.hotel_id);
  res.json({ pending: { order, hotel } });
});

// "satisfaction" is asked once, immediately, right on the booking-success
// screen (BookingSheet) — it isn't gated by "pending order" logic at all,
// so skipping it has nothing to retry later; it just isn't asked again this
// booking. "stay_experience" is the one deferred question (asked once the
// stay is over, via /pending above): skipping it does NOT mark the order
// reviewed, on purpose — a skip only means "not right now, this session",
// not "never ask again" (see PRD §6.3) — the order stays pending and will
// be offered again the next time this user's session checks for one. Only
// a real stay_experience answer closes it out.
followupRouter.post("/answer", (req, res) => {
  const { orderId, hotelId, kind, choice, authorName, detailText, detailImage, detailAudio, visible } = req.body ?? {};
  if (!orderId || !hotelId || !["satisfaction", "stay_experience"].includes(kind)) {
    return res.status(400).json({ error: "invalid_input" });
  }
  const validChoices =
    kind === "satisfaction" ? ["satisfied", "neutral", "unsatisfied", "skip"] : ["clean", "ok", "dirty", "skip"];
  if (!validChoices.includes(choice)) {
    return res.status(400).json({ error: "invalid_choice" });
  }

  if (choice === "skip") {
    // Recorded too (not just silently dropped) so "反馈采集转化率" (answered
    // vs skipped) is measured off real data — a skip is itself a data point.
    insertOrderFeedback({ order_id: orderId, kind, choice: "skip", detail_text: null, detail_image: null, detail_audio: null, visible: 0 });
    return res.json({ skipped: true });
  }

  const hotel = getHotel(hotelId);
  if (!hotel) return res.status(404).json({ error: "hotel_not_found" });

  // Consent to publish, asked alongside every real answer (see the frontend
  // composer) — defaults to true only for older/simpler callers that don't
  // send it; anything explicitly false is honored. Either way the raw
  // answer is always recorded in order_feedback ("stored in the database").
  const isVisible = visible !== false;

  insertOrderFeedback({
    order_id: orderId,
    kind,
    choice,
    detail_text: typeof detailText === "string" && detailText.trim() ? detailText.trim() : null,
    detail_image: typeof detailImage === "string" ? detailImage : null,
    detail_audio: typeof detailAudio === "string" ? detailAudio : null,
    visible: isVisible ? 1 : 0,
  });

  // Every real answer the user agreed to publish — satisfaction included —
  // becomes a review, not just stay_experience: any feedback the user
  // actually consented to share should show up in the collected corpus.
  let review = undefined;
  if (isVisible) {
    const topicFallback = kind === "satisfaction" ? ["AI推荐"] : ["干净"];
    const canned = kind === "satisfaction" ? SATISFACTION_CHOICE_TEXT[choice] : STAY_CHOICE_TEXT[choice];
    review = insertAiCollectedReview({
      hotel_id: hotelId,
      author: authorName || "匿名住客",
      source: "ai_collected",
      topics: deriveTopicsFromText(detailText, topicFallback),
      text: (typeof detailText === "string" && detailText.trim()) || canned,
    });
  }

  if (kind === "stay_experience") markOrderReviewed(orderId);

  res.json({ review, hotel });
});
