-- elfia-store 0003 — Billplz: remember which gateway bill belongs to which
-- order, so a verified callback flips the order by bill id.
ALTER TABLE orders ADD COLUMN bill_id TEXT;
CREATE INDEX idx_orders_bill ON orders(bill_id);
