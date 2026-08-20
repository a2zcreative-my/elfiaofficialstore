-- elfia-store 0001 — products, orders, daily order counters.
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_active ON products(active, sort);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,          -- the customer's key; 32 hex chars
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  items TEXT NOT NULL,                 -- JSON snapshot WITH prices at purchase time
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  receipt_key TEXT,                    -- R2 receipts/ (never publicly served)
  payment_method TEXT,                 -- bank_transfer / fpx
  tracking_no TEXT,
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_orders_status ON orders(status, created_at);

CREATE TABLE order_counters (
  day TEXT PRIMARY KEY,               -- YYYYMMDD (Malaysia time)
  counter INTEGER NOT NULL
);
