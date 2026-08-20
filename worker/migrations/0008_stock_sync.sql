-- elfia-store 0008 — two-way inventory sync with the agency portal
-- (CEO, 20-08-2026: asked whether the inventory stays live and accurate
-- against the agency portal. It did not — the sync was a button, one-way,
-- and switched off.)
--
-- THE SHAPE OF THE PROBLEM
-- Two systems sell the same physical pieces: the portal runs the live
-- sessions, this store takes web orders. Neither can be trusted to be
-- reachable at the moment the other makes a sale, and a lost sale message
-- means the two silently disagree about how many scarves exist.
--
-- So the store does NOT fire-and-forget an HTTP call when something sells.
-- Every movement is written to an OUTBOX first, in the same breath as the
-- order, and delivered afterwards — immediately if the portal answers, on
-- the next cron tick if it does not. Nothing is ever lost by a network
-- error; the worst case is a delay.
--
--   id       A UUID minted here. The portal MUST treat it as an idempotency
--            key and ignore an id it has already applied. That is what makes
--            a retry safe: we would rather send twice than not at all.
--   delta    Negative = the store took pieces off the shelf (an order).
--            Positive = it put them back (an unpaid order cancelled).
--            The portal applies the delta; it never receives an absolute
--            count from us, because it — not the store — owns the true one.
--   sent_at  NULL until the portal has acknowledged it. The pull side refuses
--            to overwrite the count of any SKU that still has unsent events,
--            so a stale number can never undo a sale the portal has not seen.
CREATE TABLE stock_events (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,              -- 'order' | 'cancel'
  order_number TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX idx_stock_events_unsent ON stock_events(sent_at, created_at);
CREATE INDEX idx_stock_events_sku ON stock_events(sku, sent_at);

-- Small key/value scratchpad so /admin can show whether the sync is actually
-- alive: last_pull_at, last_pull_result, last_push_at, last_push_error.
-- A sync that fails quietly is worse than no sync at all.
CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
