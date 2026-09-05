import { Router } from "express";
import { getMetricsSummary } from "../db/repo.js";

// Internal-only debug endpoint backing the /?debug=metrics page (PRD §10).
// Not linked from anywhere in the normal user-facing nav.
export const metricsRouter = Router();

metricsRouter.get("/", (_req, res) => {
  res.json(getMetricsSummary());
});
