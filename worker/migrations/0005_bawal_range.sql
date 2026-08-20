-- elfia-store 0005 — the ten-piece Bawal range from the CEO's new photo pack.
--
-- The 0002/0004 rows were seeded from the FIRST photo pack and were always
-- placeholders ("PRICES AND STOCK ARE PLACEHOLDERS"). The new pack supersedes
-- them, so this migration retires those rows and lays down LUMI001–LUMI010.
--
-- WHAT IS AND IS NOT TOUCHED
-- Both statements below are scoped to `image_key LIKE '/collection/shawl-%'` —
-- the four photos that shipped with the 0002 seed. No product in the new range
-- uses those files, and any row whose photo the CEO replaced in /admin is that
-- row's own product now and is left completely alone. Renames, price edits and
-- stock edits do NOT protect a row: keeping the old seed photo is what marks it
-- as still-a-placeholder.
--
-- Retiring means active = 0 (hidden from the shop), never DELETE: past orders
-- keep their own price/name snapshot, and a hidden row can be brought back or
-- removed by hand in /admin → Products.
UPDATE products
SET active = 0,
    featured = 0,       -- so an unhidden row does not walk back into the hero
    sku = NULL          -- frees LUMI001–LUMI004 so no two rows share a code
                        -- (the portal stock sync matches BY SKU across hidden
                        --  rows too, and must never see the same code twice)
WHERE active = 1
  AND image_key LIKE '/collection/shawl-%';

-- The range. Photo files ship with the site (public/collection/); anything
-- uploaded later in /admin goes to R2 instead and renders identically.
--
-- PRICES: RM 49 for the six plain/gradient designs, RM 59 for the four
-- printed designs (gold-line and floral). Confirmed by the CEO, 20-08-2026.
--
-- STOCK: seeded at 0 ON PURPOSE — every design reads "Sold out" until the real
-- counts arrive, so nothing can be oversold before the books are reconciled.
-- Set them in /admin → Products, or press "Sync stock from portal" to pull the
-- live portal counts by SKU. THE SHOP HAS NOTHING BUYABLE UNTIL THAT RUNS.
INSERT INTO products (name, description, price_cents, stock, image_key, active, sort, sku, category, featured) VALUES
  ('Bawal Premium — Dusty Rose',   'Soft rose gradient with pearl-white flow lines. Lightweight, opaque, holds its shape all day.',        4900, 0, '/collection/bawal-dusty-rose.jpg',    1,  10, 'LUMI001', 'bawal', 1),
  ('Bawal Premium — Periwinkle',   'Cool periwinkle blue washed with lilac. Lightweight, opaque, easy to style for work or weekend.',      4900, 0, '/collection/bawal-periwinkle.jpg',    1,  20, 'LUMI002', 'bawal', 0),
  ('Bawal Premium — Lavender',     'Deep lavender with pale ribbon streaks. Lightweight, opaque, no ironing drama.',                       4900, 0, '/collection/bawal-lavender.jpg',      1,  30, 'LUMI003', 'bawal', 0),
  ('Bawal Premium — Silver Grey',  'Quiet silver grey with soft white currents. The neutral that goes with everything.',                   4900, 0, '/collection/bawal-silver-grey.jpg',   1,  40, 'LUMI004', 'bawal', 0),
  ('Bawal Premium — Pastel Aurora','Blue, lilac and blush melting into one another. The showpiece of the pastel range.',                   4900, 0, '/collection/bawal-aurora.jpg',        1,  50, 'LUMI005', 'bawal', 1),
  ('Bawal Premium — Dawn Blue',    'Powder blue fading into warm sand, traced with fine gold. Soft enough for day, dressy enough for more.',4900, 0, '/collection/bawal-dawn-blue.jpg',     1,  60, 'LUMI006', 'bawal', 0),
  ('Bawal Premium — Navy Gold',    'Deep navy with hand-drawn gold flow lines and scattered stars. Printed premium finish.',               5900, 0, '/collection/bawal-navy-gold.jpg',     1,  70, 'LUMI007', 'bawal', 1),
  ('Bawal Premium — Midnight Gold','Near-black midnight with fine gold pinstripes and a gold border. The evening piece.',                  5900, 0, '/collection/bawal-midnight-gold.jpg', 1,  80, 'LUMI008', 'bawal', 0),
  ('Bawal Premium — Olive Floral', 'Olive with a gold outline peony print and a fine gold edge. Printed premium finish.',                  5900, 0, '/collection/bawal-olive-floral.jpg',  1,  90, 'LUMI009', 'bawal', 0),
  ('Bawal Premium — Mauve Floral', 'Dusty mauve with a rose-gold peony print and a fine gold edge. Printed premium finish.',               5900, 0, '/collection/bawal-mauve-floral.jpg',  1, 100, 'LUMI010', 'bawal', 1);
