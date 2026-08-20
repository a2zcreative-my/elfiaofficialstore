-- elfia-store 0004 (CEO, 20-08-2026: "the photo still not yet reflect the
-- photo that I provided which is Bawal"): every photo in the pack is the
-- BAWAL collection. The 0002 seed guessed one of them into Shawl from its
-- filename — this corrects that seeded row to Bawal with the next LUMI code.
-- Guarded to the UNTOUCHED seed row only: if the CEO already edited or
-- deleted it in /admin, this changes nothing. Shawl stays an empty
-- collection until its products (and its own code series) are added.
UPDATE products
SET category = 'bawal', sku = 'LUMI004', name = 'Bawal Premium — Grey (styled)'
WHERE name = 'Shawl — Grey' AND sku IS NULL AND category = 'shawl'
  AND image_key = '/collection/shawl-grey-front.jpg';
