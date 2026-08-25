
ALTER TABLE products ADD COLUMN portal_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN portal_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN image_marker TEXT;

/* The review list asks "anything waiting?" on every /admin load. */
CREATE INDEX IF NOT EXISTS idx_products_portal_pending
  ON products (portal_pending) WHERE portal_pending = 1;
