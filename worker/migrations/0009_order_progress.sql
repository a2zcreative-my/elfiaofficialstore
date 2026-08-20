-- elfia-store 0009 — order progress for the customer (CEO, 20-08-2026:
-- "I want to have a progress order status for customer").
--
-- The order page already drew five steps, but it could only ever highlight
-- the CURRENT one — there was nowhere to record when each step happened. A
-- customer asking "when did you confirm my payment?" had no answer on the
-- page, and neither did we.
--
-- order_events is that record: one row per movement, never edited, never
-- deleted. It is the order's history, so it is written for every transition
-- including the ones the system makes by itself (a receipt upload, an FPX
-- payment verified against Billplz).
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,                        -- shown to the customer; keep it plain
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_order_events ON order_events(order_id, created_at);

-- Courier, so "Shipped" can carry a working tracking link instead of a bare
-- number the customer has to paste somewhere themselves. NULL = just show the
-- number (the right answer for a courier we have no URL for).
ALTER TABLE orders ADD COLUMN tracking_courier TEXT;

-- "Track my order" lets anyone type an order number and a phone number, which
-- is a guessing surface: order numbers run ELF-DDMMYY-1, -2, -3. The phone
-- must match too, and this table caps how fast one caller may be wrong —
-- eight misses in fifteen minutes and that address is turned away. Keyed by
-- IP rather than by order number, because the thing worth stopping is someone
-- walking the whole sequence, not a customer fumbling their own booking.
CREATE TABLE lookup_attempts (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backfill, so existing orders do not show an empty history. Two facts are
-- known for certain about every old order: it was placed (created_at), and it
-- reached its present status (updated_at, or created_at if it never moved).
-- Anything between those two is unknowable and is NOT invented here.
INSERT INTO order_events (order_id, status, note, created_at)
SELECT id, 'pending_payment', 'Order placed', created_at FROM orders;

INSERT INTO order_events (order_id, status, note, created_at)
SELECT id, status, 'Recorded before status history was kept', COALESCE(updated_at, created_at)
FROM orders WHERE status <> 'pending_payment';
