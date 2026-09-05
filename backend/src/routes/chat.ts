import { Router } from "express";
import { handleTurn, resetSession } from "../services/chatEngine.js";

export const chatRouter = Router();

chatRouter.post("/message", async (req, res) => {
  const { sessionId, text, userName } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const result = await handleTurn(sessionId, text.trim(), typeof userName === "string" ? userName : undefined);
  res.json(result);
});

chatRouter.post("/reset", (req, res) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId !== "string") return res.status(400).json({ error: "missing_fields" });
  resetSession(sessionId);
  res.json({ ok: true });
});
