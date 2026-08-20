-- elfia-store 0010 — customer accounts, unpaid-order holds, and one rate
-- limiter for the whole API.
--
-- Three things the CEO asked for on 20-08-2026, which share a schema:
--   1. "no joy buyer"  — an unpaid order must not hold stock for ever.
--   2. "make sure my system are secure from attacking" — every guessable
--      endpoint needs a cost.
--   3. sign up / sign in, because "when customer half way make the order,
--      they refresh to main page it missing their order".
--
-- ---------------------------------------------------------------- accounts
-- Guest checkout is NOT removed. An account is a convenience — saved address,
-- order history across devices — and orders carry customer_id only when the
-- buyer happened to be signed in. Forcing sign-up in front of payment is how
-- a small shop loses the sale.
--
-- Passwords are stored as PBKDF2-SHA256 with a per-user salt, and the
-- iteration count is stored WITH the hash so it can be raised later without
-- locking anyone out. The plaintext never touches this database.
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,          -- always lowercased before it gets here
  name TEXT NOT NULL,
  phone TEXT,
  phone_digits TEXT,                   -- digits only, for matching orders
  address TEXT,
  pw_hash TEXT NOT NULL,               -- hex
  pw_salt TEXT NOT NULL,               -- hex
  pw_iter INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX idx_customers_phone ON customers(phone_digits);

-- Sessions are stored as a HASH of the cookie value, never the value itself:
-- someone who reads this table still cannot sign in as anybody. Same reason
-- passwords are hashed.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_customer ON sessions(customer_id);

-- ------------------------------------------------------------ order holds
-- customer_id  NULL for a guest order — the normal case, and it stays valid.
-- phone_digits the join between a guest order and the person who placed it;
--              also what the "two open orders per phone" rule counts.
-- expires_at   when an unpaid order releases its stock. NOT a soft reminder:
--              the cron cancels it, restocks, and tells the portal.
ALTER TABLE orders ADD COLUMN customer_id INTEGER;
ALTER TABLE orders ADD COLUMN phone_digits TEXT;
ALTER TABLE orders ADD COLUMN expires_at TEXT;

CREATE INDEX idx_orders_phone ON orders(phone_digits, status);
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX idx_orders_expiry ON orders(status, expires_at);

-- Backfill. SQLite has no regex, so strip the characters people actually type.
UPDATE orders SET phone_digits =
  replace(replace(replace(replace(replace(phone, ' ', ''), '+', ''), '-', ''), '(', ''), ')', '')
WHERE phone_digits IS NULL;

-- Existing unpaid orders get the same deadline as new ones, counted from when
-- they were placed. An order already older than that is picked up by the very
-- next cron run and released — which is the correct answer for an order that
-- has been sitting unpaid since before this rule existed.
UPDATE orders SET expires_at = datetime(created_at, '+12 hours')
WHERE expires_at IS NULL AND status IN ('pending_payment', 'payment_review');

-- ----------------------------------------------------------- rate limiting
-- One table for every "you are going too fast" rule: order lookups, sign-in
-- attempts, the admin passcode, order placement. `bucket` is the rule and the
-- caller joined together, e.g. "login:203.0.113.1" or "admin:203.0.113.1",
-- so a limit on one never starves another.
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Superseded by rate_limits (0009's version only knew about order lookups).
DROP TABLE lookup_attempts;
