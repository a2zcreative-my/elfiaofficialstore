-- elfia-store 0006 — the restock waitlist ("Notify me" on a sold-out design).
--
-- A sold-out product used to be a dead end. Now it takes a name and a
-- WhatsApp number so the shop can tell that customer when the design is back.
-- Deliberate properties:
--   * ONE ROW PER PERSON PER PRODUCT — the unique index below makes a repeat
--     submission overwrite the old one instead of stacking up. A refreshed
--     form cannot flood the list.
--   * notified_at NULL = still waiting. Marking someone notified keeps the row
--     (so you can see who was already told) rather than deleting the evidence.
--   * No email column: the store confirms everything on WhatsApp already, and
--     a field nobody reads is a field that leaks.
CREATE TABLE restock_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,          -- as typed; digits are extracted for wa.me links
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT
);
CREATE UNIQUE INDEX idx_restock_once ON restock_requests(product_id, phone);
CREATE INDEX idx_restock_open ON restock_requests(notified_at, created_at);
