-- elfia-store 0002 — collections (CEO, 20-08-2026): "I have 2 collection
-- which is 1 for Bawal and 1 for Shawl, Bawal starting with LUMI code."
--   sku       — the collection code (Bawal = LUMI001, LUMI002, …)
--   category  — 'bawal' | 'shawl' (the storefront's filter tabs)
--   featured  — 1 = appears in the home-page hero carousel
ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'bawal';
ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

-- Seed the Bawal collection from the CEO's photo pack. image_key values
-- starting with "/" are static site files (public/collection/); everything
-- an admin uploads later goes to R2 instead — both render the same way.
-- PRICES AND STOCK ARE PLACEHOLDERS (RM 49 / 10 pcs) — set the real numbers
-- in /admin before announcing the store.
INSERT INTO products (name, description, price_cents, stock, image_key, active, sort, sku, category, featured) VALUES
  ('Bawal Premium — Beige',  'ELFIA premium bawal in soft beige. Lightweight, opaque, and effortless to style.', 4900, 10, '/collection/shawl-beige.jpg',  1, 10, 'LUMI001', 'bawal', 1),
  ('Bawal Premium — Taupe',  'ELFIA premium bawal in warm taupe. Lightweight, opaque, and effortless to style.', 4900, 10, '/collection/shawl-taupe.jpg',  1, 20, 'LUMI002', 'bawal', 1),
  ('Bawal Premium — Grey',   'ELFIA premium bawal in cool grey. Lightweight, opaque, and effortless to style.',  4900, 10, '/collection/shawl-grey.jpg',   1, 30, 'LUMI003', 'bawal', 1),
  ('Shawl — Grey',           'ELFIA long shawl in cool grey. Set the SKU for the Shawl collection in /admin.',   5900, 10, '/collection/shawl-grey-front.jpg', 1, 40, NULL, 'shawl', 0);
