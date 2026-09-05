import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hotelsRouter } from "./routes/hotels.js";
import { authRouter } from "./routes/auth.js";
import { ordersRouter } from "./routes/orders.js";
import { followupRouter } from "./routes/followup.js";
import { chatRouter } from "./routes/chat.js";
import { metricsRouter } from "./routes/metrics.js";
import { funnelRouter } from "./routes/funnel.js";
import { hasApiKey } from "./services/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Unset (default): allow all origins — fine for the merged single-service
// deployment, where the frontend is same-origin and never sends a CORS
// preflight anyway. Set ALLOWED_ORIGIN (comma-separated) when the frontend is
// deployed separately (e.g. on Vercel) so the API only responds to it.
const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins } : undefined));
// Default 100kb is too small once followup answers can carry an optional
// base64 photo/voice attachment (see routes/followup.ts) — 8mb keeps that
// comfortably possible while still bounding request size.
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiConfigured: hasApiKey() });
});

app.use("/api/hotels", hotelsRouter);
app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/followup", followupRouter);
app.use("/api/chat", chatRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/funnel-events", funnelRouter);

// Production deploy: this same service also serves the built frontend
// (frontend/dist, copied alongside dist/ at deploy time — see README) so
// there's one host, one origin, and the frontend's relative /api/* fetches
// keep working with no base-URL configuration. Dev mode still uses Vite's
// own dev server + proxy instead (see frontend/vite.config.ts).
if (process.env.NODE_ENV === "production") {
  const staticDir = path.join(__dirname, "public");
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`出发喽 backend listening on http://localhost:${port}`);
  if (!hasApiKey()) {
    console.warn("⚠️  OPENAI_API_KEY is not set — /api/chat will return a graceful error until it is configured.");
  }
});
