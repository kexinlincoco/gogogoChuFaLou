import { Router } from "express";
import { createOrder, getHotel } from "../db/repo.js";
import { db } from "../db/client.js";
import { totalPrice } from "../services/pricing.js";
import { getUserTurnCount } from "../services/chatEngine.js";
import type { Order } from "../types.js";

export const ordersRouter = Router();

ordersRouter.post("/", (req, res) => {
  const { userId, hotelId, checkin, checkout, guests, source, sessionId } = req.body ?? {};
  if (!userId || !hotelId || !checkin || !checkout) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const hotel = getHotel(hotelId);
  if (!hotel) return res.status(404).json({ error: "hotel_not_found" });

  const orderSource: Order["source"] = source === "ai_chat" ? "ai_chat" : "manual_filter";
  const total = totalPrice(hotel.id, hotel.base_price, checkin, checkout);
  // MVP: payment is simulated as always-succeeding (PRD §8, no real payment gateway).
  const order = createOrder({
    user_id: userId,
    hotel_id: hotelId,
    checkin,
    checkout,
    guests: guests ?? 2,
    total_price: total,
    source: orderSource,
    chat_turns_before_order: orderSource === "ai_chat" && typeof sessionId === "string" ? getUserTurnCount(sessionId) : null,
  });

  res.json({ order, hotel });
});

ordersRouter.get("/", (req, res) => {
  const { userId } = req.query;
  if (typeof userId !== "string") return res.status(400).json({ error: "missing_userId" });
  const rows = db.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as Order[];
  res.json({ orders: rows });
});
