

ALTER TABLE products ADD COLUMN compare_price_cents INTEGER;

CREATE TABLE IF NOT EXISTS portal_slides (
  portal_id INTEGER PRIMARY KEY,       -- the portal's slide id — the sync key
  image_key TEXT NOT NULL,             -- our own R2 copy: slides/{portal_id}-…
  image_marker TEXT NOT NULL,          -- the portal's change marker (re-download gate)
  title TEXT,
  subtitle TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
