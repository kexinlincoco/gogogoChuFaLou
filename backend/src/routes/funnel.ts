import { Router } from "express";
import { insertFunnelEvent } from "../db/repo.js";

// PRD §10: conversion-funnel instrumentation for the booking sheet →
// payment page flow. Fire-and-forget from the frontend — never blocks or
// fails the actual booking flow, so errors here are swallowed to a 400/500
// without surfacing to the user.
export const funnelRouter = Router();

funnelRouter.post("/", (req, res) => {
  const { hotelId, sessionId, source, stage } = req.body ?? {};
  if (
    !hotelId ||
    !["ai_chat", "manual_filter"].includes(source) ||
    !["sheet_opened", "confirm_clicked", "payment_completed"].includes(stage)
  ) {
    return res.status(400).json({ error: "invalid_input" });
  }
  insertFunnelEvent({
    hotel_id: hotelId,
    session_id: typeof sessionId === "string" ? sessionId : null,
    source,
    stage,
  });
  res.json({ ok: true });
});
