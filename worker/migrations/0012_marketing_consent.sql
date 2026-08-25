-- elfia-store 0012 — PDPA marketing consent (v1.3.0).
--
-- CEO, 24-08-2026: marketing must be able to reach customers — but under
-- PDPA 2010, direct marketing needs the customer's CONSENT, recorded, dated,
-- and withdrawable. So consent is a fact with a timestamp, never a default:
--
--   customers.marketing_consent_at   when the account holder ticked the box
--                                    (sign-up or account page). NULL = no
--                                    consent — the only state anyone is in
--                                    without acting. Withdrawal sets it back
--                                    to NULL; the account page has the toggle.
--
--   orders.marketing_consent         the same tick at guest checkout, kept on
--                                    the order because a guest has no account
--                                    row to carry it. 0 = not ticked.
--
-- Both are DEFAULT-off: an untouched form never consents to anything.
-- The portal receives the flag over the orders feed and builds its marketing
-- lists ONLY from rows where consent is present.

ALTER TABLE customers ADD COLUMN marketing_consent_at TEXT;
ALTER TABLE orders ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0;
