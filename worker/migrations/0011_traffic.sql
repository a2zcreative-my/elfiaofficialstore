-- elfia-store 0011 — anonymous visitor traffic (v1.2.0).
--
-- CEO, 22-08-2026: "for ELFIA, I want to have a traffic to see which user
-- that visit my pages" — rendered in the portal as a Malaysia state map.
--
-- WHAT IS DELIBERATELY NOT HERE: any way to name a person. The decision
-- (OD-20a in the portal's implementation plan) is aggregates only:
--   * no IP address is ever stored;
--   * `visitor` is a keyed hash whose key includes the calendar day, so the
--     same phone gets a DIFFERENT hash tomorrow — visitors can be counted
--     within a day but never followed across days;
--   * no cookie, no localStorage ID, nothing written into the browser.
-- The raw hit rows exist only so the day's aggregates can be recomputed as
-- hits arrive, and the cron deletes them after 60 days (OD-22).

-- One row per page view. Written by POST /api/v1/t, read only by the rollup.
CREATE TABLE traffic_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,                    -- Malaysian calendar day, YYYY-MM-DD
  visitor TEXT NOT NULL,                -- daily-rotating keyed hash, 16 hex
  state TEXT NOT NULL,                  -- Cloudflare region, e.g. "Selangor";
                                        -- "Outside Malaysia" for foreign hits
  city TEXT NOT NULL DEFAULT '',        -- Cloudflare city, best-effort
  path TEXT NOT NULL,                   -- the page, query stripped (id kept)
  referrer TEXT,                        -- external referrer HOST only, or NULL
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_traffic_hits_day ON traffic_hits(day);

-- The aggregates the portal pulls (bridge feed D) and the admin reads.
-- Grain: one row per (day, state, city, path), plus ONE total row per day
-- with state='', city='', path='' — that row's `visitors` is the day's true
-- unique-visitor count, which per-group numbers cannot be summed into.
-- Recomputed in full for today and yesterday on every 5-minute cron, so a
-- day older than yesterday is final and safe to cache on the portal side.
CREATE TABLE traffic_daily (
  day TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  visits INTEGER NOT NULL DEFAULT 0,    -- page views
  visitors INTEGER NOT NULL DEFAULT 0,  -- distinct daily hashes in this group
  PRIMARY KEY (day, state, city, path)
);
