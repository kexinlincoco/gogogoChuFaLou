import { Router } from "express";
import { findUserByPhone, createUser, setUserNameIfMissing } from "../db/repo.js";

export const authRouter = Router();

// PRD §6.5 / §12: MVP login is a mocked phone+code flow, triggered client-side
// only at "confirm & pay" — no real SMS provider, dev code is fixed.
const DEV_CODE = "123456";

authRouter.post("/request-code", (req, res) => {
  const { phone } = req.body ?? {};
  if (typeof phone !== "string" || !/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: "invalid_phone" });
  }
  // Simulated: no real SMS is sent. Any phone number, dev code is DEV_CODE.
  res.json({ ok: true, devCode: DEV_CODE });
});

authRouter.post("/login", (req, res) => {
  const { phone, code, name } = req.body ?? {};
  if (typeof phone !== "string" || !/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: "invalid_phone" });
  }
  if (code !== DEV_CODE) {
    return res.status(401).json({ error: "invalid_code" });
  }
  const nameHint = typeof name === "string" && name.trim() ? name.trim() : null;
  let user = findUserByPhone(phone) ?? createUser(phone, nameHint);
  // Existing account with no name on file yet (e.g. created before this
  // field existed) — backfill it from this login's hint, but never
  // overwrite an already-locked-in name.
  if (!user.name && nameHint) {
    user = setUserNameIfMissing(user.id, nameHint);
  }
  res.json({ user });
});
