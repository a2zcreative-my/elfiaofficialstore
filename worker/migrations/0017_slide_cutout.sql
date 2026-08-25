-- 0017 slide cut-out (store v1.11.0)
-- Adds the model cut-out that stands out of the hero banner.
-- cutout_key    our own R2 copy of the PNG
-- cutout_marker the portal change marker that gates re-download
-- cutout_side   left or right, which end she stands at
-- cutout_scale  her height as a per cent of the banner, 100 to 160
-- All nullable, so a slide without one draws exactly as before.
-- Full rationale lives in CHANGELOG.md v1.11.0. Keep migrations plain ASCII
-- with no quotes or semicolons inside comments: the remote D1 API rejected
-- an earlier version of this file with "SQL code did not contain a
-- statement", and tests/migration-safety.mjs now enforces the rule.

ALTER TABLE portal_slides ADD COLUMN cutout_key TEXT;

ALTER TABLE portal_slides ADD COLUMN cutout_marker TEXT;

ALTER TABLE portal_slides ADD COLUMN cutout_side TEXT;

ALTER TABLE portal_slides ADD COLUMN cutout_scale INTEGER;
