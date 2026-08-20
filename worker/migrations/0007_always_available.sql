-- elfia-store 0007 — "always available" products (CEO, 20-08-2026: "stock
-- become sold out which is it is incorrect ... customer can make the order
-- directly to this store").
--
-- The store now has TWO ways to decide whether a design can be bought:
--
--   track_stock = 1  Count pieces. Each order decrements the count and the
--                    design goes Sold out by itself at zero. This is the
--                    default for anything added later, and the mode to use
--                    once the portal counts are synced.
--   track_stock = 0  Always available. The count is ignored entirely: the
--                    product never reads Sold out and every order goes
--                    through. For a shop that restocks from the same supply
--                    as the live sessions, this is the honest setting —
--                    better to take the order and reconcile than to hide a
--                    design behind a number nobody is maintaining.
--
-- Every product that is live RIGHT NOW switches to always-available, because
-- they were all seeded at stock 0 in 0005 and were showing Sold out despite
-- being in stock. Hidden/retired rows keep counting, and each product can be
-- flipped back in /admin → Products at any time.
ALTER TABLE products ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 1;

UPDATE products SET track_stock = 0 WHERE active = 1;
