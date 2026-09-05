CREATE TABLE IF NOT EXISTS hotels (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  stars        INTEGER NOT NULL,
  base_price   INTEGER NOT NULL,
  tags         TEXT NOT NULL,       -- JSON array, e.g. ["海景房","安静"]
  amenities    TEXT NOT NULL,       -- JSON array, e.g. ["wifi","pool"]
  photo_query  TEXT NOT NULL DEFAULT '',  -- English keywords for the placeholder photo service, used as a fallback
  real_image_url TEXT                     -- verified real photo (e.g. Wikimedia Commons) when one exists for this hotel; NULL falls back to the placeholder built from photo_query — see services/images.ts
);

CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  hotel_id     TEXT NOT NULL REFERENCES hotels(id),
  author       TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('user','ai_collected')),
  topics       TEXT NOT NULL,       -- JSON array of keywords this sentence supports
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

-- name is the account's locked-in display name (set on first login with this
-- phone number, from whatever local nickname the user typed into NameGate
-- before logging in). Once set, it never changes on later logins — the
-- account's name always wins over a same-session local nickname, so a
-- returning phone number is greeted by name without being asked again.
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  phone        TEXT NOT NULL UNIQUE,
  name         TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id),
  hotel_id                 TEXT NOT NULL REFERENCES hotels(id),
  checkin                  TEXT NOT NULL,
  checkout                 TEXT NOT NULL,
  guests                   INTEGER NOT NULL,
  total_price              INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'completed',
  reviewed                 INTEGER NOT NULL DEFAULT 0,
  source                   TEXT NOT NULL DEFAULT 'manual_filter' CHECK (source IN ('ai_chat','manual_filter')), -- which flow the booking sheet was opened from — the raw signal behind "AI推荐采纳率"
  chat_turns_before_order  INTEGER,          -- number of user messages sent in the chat session before this order, only set when source='ai_chat'
  created_at               TEXT NOT NULL
);

-- PRD §6.3/§10: 追问反馈分两类——"AI推荐满意度"(kind='satisfaction'，预订成功
-- 那一刻就问，见BookingSheet) 和 "入住体验"(kind='stay_experience'，入住日期
-- 过去之后才问，见ChatScreen)。两类都支持一个可选的详细反馈（文字/图片/语音，
-- 三选多不互斥）。每一条真实反馈都会问用户"是否同意展示在评论区"——同意
-- (visible=1) 才会额外生成一条ai_collected评论（见repo.ts
-- insertAiCollectedReview）进入公开评论区；不同意(visible=0) 仍然写在这张表里
-- （数据没有丢，只是不公开展示），不生成评论。
CREATE TABLE IF NOT EXISTS order_feedback (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  kind          TEXT NOT NULL CHECK (kind IN ('satisfaction','stay_experience')),
  choice        TEXT NOT NULL,
  detail_text   TEXT,
  detail_image  TEXT,              -- optional base64 data URI
  detail_audio  TEXT,              -- optional base64 data URI, not transcribed (见README已知限制)
  visible       INTEGER NOT NULL DEFAULT 1,  -- user's consent to publish this as a public review; 0 = recorded but never shown in the reviews list
  created_at    TEXT NOT NULL
);

-- PRD §10: 转化漏斗埋点——打开预订弹层(sheet_opened) → 点"确认预订并支付"进入
-- 付款页(confirm_clicked) → 在付款页点"确认支付"(payment_completed，此时才真正
-- 调用createOrder写入orders表)。付款页点了就一定成功、没有"取消支付"这个显式
-- 动作，所以两个相邻阶段之间人数的差就是"看了但没往下走"的隐式流失，不需要单独
-- 记一个"cancelled"事件。
CREATE TABLE IF NOT EXISTS booking_funnel_events (
  id          TEXT PRIMARY KEY,
  hotel_id    TEXT NOT NULL REFERENCES hotels(id),
  session_id  TEXT,             -- chat sessionId when known, NULL for manual-filter opens
  source      TEXT NOT NULL CHECK (source IN ('ai_chat','manual_filter')),
  stage       TEXT NOT NULL CHECK (stage IN ('sheet_opened','confirm_clicked','payment_completed')),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_hotel ON reviews(hotel_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_order ON order_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_funnel_stage ON booking_funnel_events(stage);
